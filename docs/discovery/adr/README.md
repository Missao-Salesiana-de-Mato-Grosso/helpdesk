# Registros de decisão de arquitetura (ADRs)

Formato curto: Contexto → Decisão → Consequências. O status de todos é **Proposto** em 19/10/2026. Passa a **Aceito** depois que as perguntas 🔴 forem respondidas.

---

## ADR-001 — Monólito modular NestJS servindo o SPA React, em monorepo pnpm

**Contexto:** há 1 desenvolvedor, 5 dias e baixo volume (500 tickets/mês).
**Decisão:** uma aplicação NestJS com módulos por domínio, que também serve o build estático do React (`@nestjs/serve-static`). O repositório é um monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`).
**Consequências:** uma imagem, um deploy, um domínio e nenhum CORS. Schemas zod são compartilhados. Escalar front e back separadamente fica impossível, mas é desnecessário nessa escala. A separação continua possível no futuro, porque as fronteiras dos módulos já existem.

## ADR-002 — Modelo de identidade no Zitadel: 1 org, 1 projeto, 1 app; solicitante implícito

**Contexto:** uso interno, todos os colaboradores numa organização e cerca de 20 agentes.
**Decisão:** uma Organization, o Project "Help Desk" com as roles `admin`, `supervisor` e `agente`, e uma aplicação SPA (PKCE). O usuário autenticado da org **sem role** é solicitante. Grupos e escopo de visibilidade ficam na aplicação.
**Consequências:** não é preciso conceder grant a centenas de pessoas. O controle de quem é agente fica centralizado no Zitadel. Se outras orgs usarem a mesma instância, é obrigatório validar o `resourceowner`.

## ADR-003 — Validação local de JWT via JWKS (sem introspection)

**Contexto:** a API precisa autenticar cada request.
**Decisão:** a app SPA no Zitadel usa _Auth Token Type = JWT_. O NestJS valida a assinatura com `jose` (`createRemoteJWKSet`), além de `iss`, `aud` (project ID) e `exp`. O access token dura 1 h.
**Consequências:** não há chamada de rede ao Zitadel por request, e a API continua funcionando com o Zitadel fora do ar (até o token expirar). A revogação não é instantânea (até 1 h), o que é mitigado pela flag `active` local. Introspection fica descartada: dependência de rede em todo request e mais uma app com secret.

## ADR-004 — Login hospedado (Login V2) em vez de tela de login própria

**Contexto:** o prazo é curto e há exigências de segurança (MFA, reset de senha, lockout).
**Decisão:** usar o Login V2 do Zitadel, deployado pelo Helm chart v9, com branding configurado no Zitadel.
**Consequências:** zero código de login. É obrigatório configurar `ZITADEL_SESSION_COOKIE_SECRET` (32+ caracteres, igual em todas as réplicas, a partir da v4.19.2). Há menos controle visual que num login customizado.

## ADR-005 — Provisionamento JIT; sincronização por eventos na Fase 2

**Contexto:** a aplicação precisa de um registro local de usuário para as chaves estrangeiras (tickets, grupos).
**Decisão:** fazer upsert por `zitadel_sub` no primeiro request autenticado e atualizar nome, e-mail e roles a cada login. Contatos sem login são vinculados pelo e-mail. Na Fase 2, um Execution do tipo _Event_ no Actions v2 envia webhooks de desativação e remoção.
**Consequências:** simples e sem jobs de sincronização. Um colaborador que nunca logou não aparece na busca, a menos que um agente o cadastre como contato. A desativação depende da expiração do token e da flag manual até a Fase 2.

## ADR-006 — Prisma ORM sobre PostgreSQL (DBaaS Magalu)

**Contexto:** o ORM será usado com desenvolvimento assistido por IA, e as migrações precisam ser previsíveis.
**Decisão:** Prisma, com o `schema.prisma` como fonte única do modelo e `prisma migrate` para as migrações. O banco é o PostgreSQL gerenciado (DBaaS) da Magalu, com bancos e usuários separados para `helpdesk` e `zitadel`.
**Consequências:** tipagem forte e schema legível num único arquivo, o que funciona muito bem com o Claude Code. Queries complexas (relatórios e FTS da Fase 2) usarão `$queryRaw` tipado. TypeORM e Drizzle foram descartados (o primeiro tem migrações menos previsíveis; o segundo tem menor familiaridade).

## ADR-007 — Kubernetes gerenciado Magalu + Traefik + cert-manager, com contingência em VM

**Contexto:** o usuário escolheu o Kubernetes como plataforma. O Zitadel tem chart oficial. O prazo é crítico.
**Decisão:**

- Kubernetes gerenciado com 2 nós;
- Traefik como ingress, com backend h2c para o Zitadel;
- cert-manager com Let's Encrypt;
- Kustomize para o app e Helm para o Zitadel e o Traefik.
  O ingress-nginx não é adotado porque foi descontinuado pela comunidade Kubernetes. **Gatilho de contingência:** sem login funcional até 14 h de terça (20/10), o MVP vai para uma VM com Docker Compose.
  **Consequências:** o destino final está correto desde o início, com custo de configuração inicial maior. A contingência não altera o código.

## ADR-008 — Polling + locking otimista em vez de tempo real no MVP

**Contexto:** 20 agentes. O Freshdesk detecta colisões.
**Decisão:** as listas fazem polling a cada 30 s (TanStack Query). O `PATCH` exige `version`, e uma versão desatualizada retorna 409 com aviso na UI. WebSocket e indicador de "fulano está vendo" ficam para a Fase 2.
**Consequências:** nenhuma infraestrutura extra e nenhuma sobrescrita silenciosa. A UX é menos instantânea que a do Freshdesk.

## ADR-009 — Anexos em Object Storage S3 via URLs pré-assinadas; notificações por outbox

**Contexto:** anexos e e-mails não devem acoplar o request ao serviço externo.
**Decisão:**

- **Anexos:** bucket privado S3-compatível (Magalu). Upload multipart e download por stream, ambos pela API após a checagem de escopo. Sem URL pré-assinada: evita CORS no bucket e o mesmo caminho serve aos anexos que chegam por e-mail. Em dev, um driver de disco local.
- **E-mails:** tabela `notifications` (outbox) gravada na mesma transação do evento, enviada por cron de 1 min com retry.
  **Consequências:** o banco não incha e o SMTP fora do ar não quebra o atendimento. O e-mail pode atrasar até cerca de 1 min, o que é aceitável. Os bytes dos anexos passam pela API, o que é irrelevante para 20 MB e 25 tickets/dia.

## ADR-010 — E-mail de entrada por IMAP na caixa do Gmail, com threading por Message-ID e tag no assunto

**Contexto:** o e-mail para `suporte@missaosalesiana.org.br` é o canal principal de abertura de tickets, e os solicitantes respondem por e-mail. Terceiros só usam esse canal. A caixa é do Google Workspace.
**Decisão:** um cron de 1 min lê a caixa por **IMAP** (`imapflow`, senha de app), processa só UIDs novos, grava o `.eml` bruto no Object Storage, registra cada `Message-ID` em `inbound_emails` (idempotência) e resolve o ticket por `In-Reply-To`/`References` → `email_message_refs`, com fallback pela tag `[#1234]` no assunto. Auto-respostas e e-mails da própria caixa são descartados; há limite de 20 e-mails/h por remetente. Toda saída carrega `Message-ID` próprio, `In-Reply-To` e a tag no assunto. A caixa nunca é apagada: só recebe rótulos.
**Alternativas descartadas:** Gmail API com push via Pub/Sub (tempo real, mas exige delegação em todo o domínio, tópico Pub/Sub e endpoint público: setup pesado para 25 e-mails/dia); provedores de inbound parsing como Mailgun, SendGrid ou Postmark (mudança de MX ou encaminhamento, mais um fornecedor com dados pessoais); encaminhamento para um endpoint HTTP (o Gmail não oferece).
**Consequências:** latência de até 1 min, aceitável. Dependência de uma senha de app que precisa constar no runbook de rotação. Uma única caixa no MVP; outras caixas na Fase 2 exigem só configuração adicional. A virada do Freshdesk vira uma operação simples e reversível: remover ou recolocar o encaminhamento da caixa.

## ADR-011 — Portal aberto a qualquer conta Google, com liberação pelo admin

**Contexto:** a abertura de chamados passa a ser aberta ao público, e não só às contas `@missaosalesiana.org.br` (decisão de 2026-10-25). Mas só deve usar o portal quem o admin do suporte liberar.
**Decisão:**

- **Login:** a tela de consentimento do Google passa de **Interno** para **Externo**. O auto-cadastro por usuário e senha do Zitadel continua **desligado**: só se entra pelo Google.
- **Fila de aprovação:** quem entra pela primeira vez, interno ou externo, cai numa tela "aguardando liberação". O admin vê a fila, define unidade e departamento e aprova ou recusa. Até a aprovação, a API recusa tudo além do próprio perfil e do status.
- **Transição:** até a fila existir no código, a tela de consentimento fica como **Interno**, aceitando só o Workspace.
  **Consequências:** muda a regra "terceiros nunca fazem login" e o fluxo de 1º acesso. Precisa de spec própria (estado do usuário, tela e rotas do admin, testes na matriz de permissões) e de revisão da LGPD (`04-lgpd.md`), porque passam a existir dados pessoais de pessoas de fora que se cadastram sozinhas.
