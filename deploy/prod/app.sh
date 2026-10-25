#!/usr/bin/env bash
# Deploy do Help Desk (T17): imagem → registry, Secrets, migração (Job) e rollout em https://suporte.msmt.org.br.
# Uso: make deploy            (build + push + aplica)
#      make deploy SKIP_BUILD=1 TAG=<tag>   (reaplica uma imagem já publicada)
source "$(dirname "$0")/lib.sh"

project_id=$(overlay_value ZITADEL_PROJECT_ID)
client_id=$(overlay_value VITE_ZITADEL_CLIENT_ID)
[[ -n "$project_id" && -n "$client_id" ]] ||
  die "IDs do Zitadel vazios em deploy/k8s/overlays/prod/zitadel.env. Rode antes: make zitadel-bootstrap"

# ── Registry ────────────────────────────────────────────────────────────────────
registry_credentials() {
  # Usuário e senha do Container Registry da conta. Não são impressos.
  local json err
  err=$(mktemp)
  if ! json=$(mgc container-registry credentials get -o json --raw 2>"$err" | sed -n '/^[[:space:]]*[[{]/,$p') ||
    [[ -z "$json" ]]; then
    if grep -q "Error getting user" "$err"; then
      rm -f "$err"
      die "O login do mgc ainda não tem usuário no Container Registry. Crie-o uma vez:
  mgc container-registry users create
  e rode make deploy de novo (docs/ambientes.md §2.4)."
    fi
    grep -v -i 'outdated version' "$err" >&2 || true
    rm -f "$err"
    die "Não consegui ler as credenciais do registry (mgc container-registry credentials get)."
  fi
  rm -f "$err"
  REGISTRY_USER=$(printf '%s' "$json" | jq -r '[.. | objects | (.username? // .user? // empty)][0] // empty')
  REGISTRY_PASSWORD=$(printf '%s' "$json" | jq -r '[.. | objects | (.password? // empty)][0] // empty')
  [[ -n "$REGISTRY_USER" && -n "$REGISTRY_PASSWORD" ]] ||
    die "Formato inesperado em 'mgc container-registry credentials get' (sem username/password). Me mande só os NOMES dos campos."
}

# ── Imagem ──────────────────────────────────────────────────────────────────────
TAG="${TAG:-$(git -C "$ROOT" rev-parse --short HEAD)}"
if [[ -n "$(git -C "$ROOT" status --porcelain)" && "${SKIP_BUILD:-0}" != "1" ]]; then
  warn "Há alterações não commitadas: a imagem leva o estado atual dos arquivos."
  TAG="$TAG-dirty-$(date +%Y%m%d%H%M)"
fi
IMAGE="$IMAGE_REPO:$TAG"

registry_credentials
confirm "Publicar $IMAGE e implantar em https://$APP_HOST?"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  info "Build e push ($IMAGE, linux/amd64)"
  docker info >/dev/null 2>&1 || die "Docker não está rodando. Abra o Docker Desktop."
  printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY_HOST" -u "$REGISTRY_USER" --password-stdin >/dev/null
  docker buildx build --platform linux/amd64 --push -t "$IMAGE" \
    --build-arg VITE_ZITADEL_AUTHORITY="https://$AUTH_HOST" \
    --build-arg VITE_ZITADEL_CLIENT_ID="$client_id" \
    --build-arg VITE_ZITADEL_PROJECT_ID="$project_id" \
    "$ROOT"
  ok "Imagem publicada"
fi

# ── Secrets ─────────────────────────────────────────────────────────────────────
info "Secrets"
kctl create namespace helpdesk --dry-run=client -o yaml | kctl apply -f - >/dev/null

auth=$(printf '%s:%s' "$REGISTRY_USER" "$REGISTRY_PASSWORD" | base64 | tr -d '\n')
printf '{"auths":{"%s":{"auth":"%s"}}}' "$REGISTRY_HOST" "$auth" |
  kctl -n helpdesk create secret generic registry --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson=/dev/stdin --dry-run=client -o yaml | kctl apply -f - >/dev/null

db_host=$(require_secret database.env DB_HOST)
db_password=$(require_secret database.env DB_HELPDESK_PASSWORD)
email_file=helpdesk-email.env
{
  # sslmode: o DBaaS está na rede privada do cluster. Se o banco exigir TLS, troque por sslmode=no-verify.
  printf 'DATABASE_URL=postgresql://helpdesk:%s@%s:5432/helpdesk?schema=public\n' "$db_password" "$db_host"
  printf 'S3_ACCESS_KEY=%s\n' "$(require_secret object-storage.env S3_ACCESS_KEY)"
  printf 'S3_SECRET_KEY=%s\n' "$(require_secret object-storage.env S3_SECRET_KEY)"
  smtp_user=$(read_secret "$email_file" SMTP_USER)
  mailbox_user=$(read_secret "$email_file" MAILBOX_USER)
  if [[ -n "$smtp_user" ]]; then
    printf 'SMTP_USER=%s\nSMTP_PASSWORD=%s\n' "$smtp_user" "$(require_secret "$email_file" SMTP_PASSWORD)"
  else
    printf 'NOTIFICATIONS_ENABLED=false\n'
  fi
  if [[ -n "$mailbox_user" ]]; then
    printf 'MAILBOX_USER=%s\nMAILBOX_PASSWORD=%s\n' "$mailbox_user" "$(require_secret "$email_file" MAILBOX_PASSWORD)"
    start_since=$(read_secret "$email_file" MAILBOX_START_SINCE)
    [[ -z "$start_since" ]] || printf 'MAILBOX_START_SINCE=%s\n' "$start_since"
  else
    # Sem caixa configurada: leitura desligada (o driver imap exigiria usuário e senha na subida).
    printf 'INBOUND_ENABLED=false\nMAILBOX_DRIVER=folder\n'
  fi
} | apply_env_secret helpdesk helpdesk-secrets
[[ -n "$(read_secret "$email_file" SMTP_USER)" ]] ||
  warn "Sem SMTP em $SECRETS_DIR/$email_file: notificações por e-mail DESLIGADAS."
[[ -n "$(read_secret "$email_file" MAILBOX_USER)" ]] ||
  warn "Sem IMAP em $SECRETS_DIR/$email_file: leitura da caixa DESLIGADA."
ok "Secrets registry e helpdesk-secrets aplicados"

# ── Manifests e migração ────────────────────────────────────────────────────────
info "Configuração e migração do banco"
manifests=$(kctl kustomize "$ROOT/deploy/k8s/overlays/prod" | sed "s|$IMAGE_REPO:latest|$IMAGE|")
printf '%s\n' "$manifests" | kctl apply -f - >/dev/null
kctl -n helpdesk delete job helpdesk-migrate --ignore-not-found >/dev/null
sed "s|image: IMAGE|image: $IMAGE|" "$ROOT/deploy/k8s/base/migrate-job.yaml" | kctl apply -f - >/dev/null
if ! kctl -n helpdesk wait job/helpdesk-migrate --for=condition=complete --timeout=5m >/dev/null 2>&1; then
  kctl -n helpdesk logs job/helpdesk-migrate --tail=50 || true
  die "Migração falhou (log acima). O app em produção não foi alterado."
fi
ok "Migrações e seed aplicados"

info "Rollout"
kctl -n helpdesk rollout restart deployment/helpdesk >/dev/null
if ! kctl -n helpdesk rollout status deployment/helpdesk --timeout=5m; then
  kctl -n helpdesk logs deployment/helpdesk --tail=50 || true
  die "O app não ficou pronto (log acima)."
fi

info "Verificação"
kctl -n helpdesk wait certificate/helpdesk-tls --for=condition=Ready --timeout=5m >/dev/null 2>&1 ||
  warn "Certificado de $APP_HOST ainda não emitido: kubectl -n helpdesk describe certificate helpdesk-tls"
status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$APP_HOST/api/health" || true)
[[ "$status" == "200" ]] && ok "https://$APP_HOST/api/health = 200" || warn "https://$APP_HOST/api/health = $status"
ok "Deploy de $IMAGE concluído"
