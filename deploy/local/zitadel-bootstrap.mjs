#!/usr/bin/env node
// oxlint-disable no-console -- script de CLI: a saída no terminal é o objetivo
// Configura o Zitadel para o Help Desk. Idempotente: pode rodar quantas vezes quiser,
// inclusive depois de `pnpm infra:reset`.
//
// Uso local:    pnpm infra:bootstrap [-- --admin <email>]
// Uso produção: make zitadel-bootstrap (deploy/prod/zitadel.sh), que define BOOTSTRAP_TARGET=prod,
//               ZITADEL_ISSUER, PORTAL_URL e ZITADEL_BOOTSTRAP_PAT. Em produção: sem Development Mode,
//               sem SMTP do Mailpit, e os IDs vão para deploy/k8s/overlays/prod/zitadel.env.
//
// O que faz:
//   1. projeto "Help Desk" com Assert Roles on Authentication;
//   2. roles admin, supervisor e agente;
//   3. app SPA "Help Desk Web" (PKCE, Auth Token Type = JWT, roles no access e no ID token,
//      redirects de http://localhost:5173, Development Mode);
//   4. SMTP da instância apontando para o Mailpit (mailpit:1025, sem TLS), ativo;
//   5. com --admin <email>: concede a role admin no projeto ao usuário com esse e-mail;
//   6. grava ZITADEL_PROJECT_ID, VITE_ZITADEL_PROJECT_ID e VITE_ZITADEL_CLIENT_ID no .env da raiz.
//
// Autentica com o PAT do service user `bootstrap-admin`, que o docker-compose grava em
// .local/zitadel/admin.pat na primeira subida (em produção, ZITADEL_BOOTSTRAP_PAT, lido do Secret
// iam-admin-pat). O PAT nunca é impresso.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROD = process.env.BOOTSTRAP_TARGET === 'prod';
const ISSUER = process.env.ZITADEL_ISSUER ?? 'http://localhost:8080';
const WEB_ORIGIN = process.env.PORTAL_URL ?? 'http://localhost:5173';
const PROJECT_NAME = 'Help Desk';
const APP_NAME = 'Help Desk Web';
const ROLES = [
  { key: 'admin', displayName: 'Administrador' },
  { key: 'supervisor', displayName: 'Supervisor' },
  { key: 'agente', displayName: 'Agente' },
];
const SMTP = {
  host: 'mailpit:1025', // nome do serviço no compose: dentro do contêiner, localhost é o próprio Zitadel
  tls: false,
  user: 'mailpit',
  password: 'mailpit', // o Mailpit local aceita qualquer credencial
  senderAddress: 'zitadel@localhost',
  senderName: 'Zitadel local',
  description: 'Mailpit (dev)',
};

const adminEmail = (() => {
  const index = process.argv.indexOf('--admin');
  return index > -1 ? process.argv[index + 1] : undefined;
})();

const PAT = (() => {
  if (PROD) {
    if (!process.env.ZITADEL_BOOTSTRAP_PAT)
      fail('ZITADEL_BOOTSTRAP_PAT não definido (use make zitadel-bootstrap)');
    return process.env.ZITADEL_BOOTSTRAP_PAT.trim();
  }
  const patFile = `${ROOT}.local/zitadel/admin.pat`;
  if (!existsSync(patFile)) {
    fail(`PAT não encontrado em ${patFile}. A infra local está no ar? (pnpm infra:up)`);
  }
  return readFileSync(patFile, 'utf8').trim();
})();

async function api(method, path, body) {
  const init = {
    method,
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(`${ISSUER}${path}`, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`${method} ${path} → ${response.status}: ${json.message ?? text}`);
    error.status = response.status;
    error.zitadel = json;
    throw error;
  }
  return json;
}

const alreadyExists = (error) => error.status === 409 || error.zitadel?.code === 6;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function ensureProject() {
  const { result = [] } = await api('POST', '/management/v1/projects/_search', {
    queries: [{ nameQuery: { name: PROJECT_NAME, method: 'TEXT_QUERY_METHOD_EQUALS' } }],
  });
  const settings = {
    name: PROJECT_NAME,
    projectRoleAssertion: true,
    projectRoleCheck: false,
    hasProjectCheck: false,
  };
  if (result[0]) {
    try {
      await api('PUT', `/management/v1/projects/${result[0].id}`, settings);
    } catch (error) {
      if (error.zitadel?.code !== 9) throw error; // 9 = nada mudou
    }
    console.log(`✔ projeto "${PROJECT_NAME}" já existia (${result[0].id})`);
    return result[0].id;
  }
  const { id } = await api('POST', '/management/v1/projects', settings);
  console.log(`✔ projeto "${PROJECT_NAME}" criado (${id})`);
  return id;
}

async function ensureRoles(projectId) {
  const { result = [] } = await api(
    'POST',
    `/management/v1/projects/${projectId}/roles/_search`,
    {},
  );
  const existing = new Set(result.map((role) => role.key));
  const missing = ROLES.filter((role) => !existing.has(role.key));
  if (missing.length > 0) {
    await api('POST', `/management/v1/projects/${projectId}/roles/_bulk`, { roles: missing });
  }
  console.log(
    `✔ roles: ${ROLES.map((r) => r.key).join(', ')}${missing.length ? ` (criadas: ${missing.map((r) => r.key).join(', ')})` : ''}`,
  );
}

async function ensureApp(projectId) {
  const config = {
    redirectUris: [`${WEB_ORIGIN}/auth/callback`],
    postLogoutRedirectUris: [`${WEB_ORIGIN}/`],
    responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
    grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
    appType: 'OIDC_APP_TYPE_USER_AGENT',
    authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
    // Development Mode aceita redirect sem HTTPS: só no ambiente local.
    devMode: !PROD,
    accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
  };
  const { result = [] } = await api('POST', `/management/v1/projects/${projectId}/apps/_search`, {
    queries: [{ nameQuery: { name: APP_NAME, method: 'TEXT_QUERY_METHOD_EQUALS' } }],
  });
  if (result[0]) {
    try {
      await api(
        'PUT',
        `/management/v1/projects/${projectId}/apps/${result[0].id}/oidc_config`,
        config,
      );
    } catch (error) {
      if (error.zitadel?.code !== 9) throw error;
    }
    const clientId = result[0].oidcConfig?.clientId;
    console.log(`✔ app "${APP_NAME}" já existia (client id ${clientId})`);
    return clientId;
  }
  const { clientId } = await api('POST', `/management/v1/projects/${projectId}/apps/oidc`, {
    name: APP_NAME,
    ...config,
  });
  console.log(`✔ app "${APP_NAME}" criada (client id ${clientId})`);
  return clientId;
}

async function ensureSmtp() {
  const { result = [] } = await api('POST', '/admin/v1/smtp/_search', {});
  let config = result.find((item) => item.description === SMTP.description);
  if (!config) {
    const { id } = await api('POST', '/admin/v1/smtp', SMTP);
    config = { id };
    console.log('✔ SMTP do Mailpit criado');
  }
  try {
    await api('POST', `/admin/v1/smtp/${config.id}/_activate`, {});
  } catch (error) {
    if (!alreadyExists(error) && error.zitadel?.code !== 9) throw error;
  }
  console.log('✔ SMTP do Mailpit ativo (e-mails do Zitadel em http://localhost:8025)');
}

async function ensureAdminGrant(projectId, email) {
  const { result = [] } = await api('POST', '/v2/users', {
    queries: [{ emailQuery: { emailAddress: email } }],
  });
  const user = result[0];
  if (!user) fail(`usuário com e-mail ${email} não existe no Zitadel local`);
  const { result: grants = [] } = await api('POST', '/management/v1/users/grants/_search', {
    queries: [{ userIdQuery: { userId: user.userId } }, { projectIdQuery: { projectId } }],
  });
  const grant = grants[0];
  if (!grant) {
    await api('POST', `/management/v1/users/${user.userId}/grants`, {
      projectId,
      roleKeys: ['admin'],
    });
  } else if (!grant.roleKeys?.includes('admin')) {
    await api('PUT', `/management/v1/users/${user.userId}/grants/${grant.id}`, {
      roleKeys: [...(grant.roleKeys ?? []), 'admin'],
    });
  }
  console.log(`✔ ${email} tem a role admin no projeto`);
}

function writeEnv(values) {
  const envFile = PROD ? `${ROOT}deploy/k8s/overlays/prod/zitadel.env` : `${ROOT}.env`;
  if (!existsSync(envFile)) fail(`${envFile} não existe. Rode: cp .env.example .env`);
  let content = readFileSync(envFile, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    content = pattern.test(content)
      ? content.replace(pattern, line)
      : `${content.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envFile, content);
  console.log(`✔ ${envFile.slice(ROOT.length)} atualizado: ${Object.keys(values).join(', ')}`);
}

try {
  const projectId = await ensureProject();
  await ensureRoles(projectId);
  const clientId = await ensureApp(projectId);
  // Em produção o Zitadel ainda não envia e-mail (o login é pelo Google); SMTP fica para depois.
  if (!PROD) await ensureSmtp();
  if (adminEmail) await ensureAdminGrant(projectId, adminEmail);
  writeEnv(
    PROD
      ? { ZITADEL_PROJECT_ID: projectId, VITE_ZITADEL_CLIENT_ID: clientId }
      : {
          ZITADEL_PROJECT_ID: projectId,
          VITE_ZITADEL_PROJECT_ID: projectId,
          VITE_ZITADEL_CLIENT_ID: clientId,
        },
  );
} catch (error) {
  fail(error.message);
}
