#!/usr/bin/env bash
# Zitadel de produção (etapa 4): Secrets, Helm (chart oficial, imagem v4.19.5) e certificado.
source "$(dirname "$0")/lib.sh"

info "Segredos do Zitadel ($SECRETS_DIR/zitadel.env)"
if [[ -z "$(read_secret zitadel.env ZITADEL_MASTERKEY)" ]]; then
  # A masterkey cifra dados no banco: gerada uma vez e NUNCA trocada (perdê-la = perder o Zitadel).
  write_secret zitadel.env ZITADEL_MASTERKEY "$(random_alnum 32)"
  ok "Masterkey gerada. Guarde uma cópia de zitadel.env no cofre da equipe."
fi
if [[ -z "$(read_secret zitadel.env ZITADEL_ADMIN_PASSWORD)" ]]; then
  # Política padrão do Zitadel: maiúscula, minúscula, número e símbolo.
  write_secret zitadel.env ZITADEL_ADMIN_PASSWORD "$(random_alnum 24)Aa1!"
fi
if [[ -z "$(read_secret zitadel.env ZITADEL_LOGIN_COOKIE_SECRET)" ]]; then
  write_secret zitadel.env ZITADEL_LOGIN_COOKIE_SECRET "$(random_alnum 48)"
fi
ok "Segredos prontos (não impressos)"

db_host=$(require_secret database.env DB_HOST)
db_password=$(require_secret database.env DB_ZITADEL_PASSWORD)
masterkey=$(require_secret zitadel.env ZITADEL_MASTERKEY)
admin_password=$(require_secret zitadel.env ZITADEL_ADMIN_PASSWORD)
cookie_secret=$(require_secret zitadel.env ZITADEL_LOGIN_COOKIE_SECRET)

confirm "Instalar/atualizar o Zitadel v4.19.5 (chart $ZITADEL_CHART_VERSION) no namespace zitadel, em https://$AUTH_HOST?"

kctl create namespace zitadel --dry-run=client -o yaml | kctl apply -f - >/dev/null
printf 'masterkey=%s\n' "$masterkey" | apply_env_secret zitadel zitadel-masterkey
printf 'ZITADEL_SESSION_COOKIE_SECRET=%s\n' "$cookie_secret" | apply_env_secret zitadel zitadel-login-cookie
# Configuração sensível em YAML (mesclada pelo Zitadel com a do values.yaml).
kctl -n zitadel create secret generic zitadel-config --from-file=config-yaml=/dev/stdin \
  --dry-run=client -o yaml <<YAML | kctl apply -f - >/dev/null
Database:
  Postgres:
    Host: "$db_host"
    User:
      Password: "$db_password"
FirstInstance:
  Org:
    Human:
      Password: "$admin_password"
YAML
ok "Secrets zitadel-masterkey, zitadel-login-cookie e zitadel-config aplicados"

info "Helm"
hlm repo add zitadel https://charts.zitadel.com >/dev/null 2>&1 || true
hlm repo update zitadel >/dev/null
hlm upgrade --install zitadel zitadel/zitadel --version "$ZITADEL_CHART_VERSION" -n zitadel \
  -f "$ROOT/deploy/zitadel/values.yaml" --wait --timeout 15m
ok "Zitadel instalado"

info "Certificado (Let's Encrypt)"
if kctl -n zitadel wait certificate/zitadel-tls --for=condition=Ready --timeout=5m >/dev/null 2>&1; then
  ok "Certificado de $AUTH_HOST emitido"
else
  warn "Certificado ainda não emitido. Veja: kubectl -n zitadel describe certificate zitadel-tls"
fi
cat <<MSG

Console: https://$AUTH_HOST/ui/console
Admin de emergência: zitadel-admin (senha em $SECRETS_DIR/zitadel.env, ZITADEL_ADMIN_PASSWORD).
Próximo: make zitadel-bootstrap
MSG
