#!/usr/bin/env bash
# Projeto "Help Desk", roles e app SPA no Zitadel de produção. Grava os IDs (não secretos) em
# deploy/k8s/overlays/prod/zitadel.env. O PAT vem do Secret iam-admin-pat e não é impresso.
source "$(dirname "$0")/lib.sh"

info "Bootstrap do Zitadel de produção"
pat=$(kctl -n zitadel get secret iam-admin-pat -o jsonpath='{.data.pat}' 2>/dev/null | base64 -d || true)
[[ -n "$pat" ]] || die "Secret iam-admin-pat não encontrado. O Zitadel foi instalado? (make zitadel)"
BOOTSTRAP_TARGET=prod ZITADEL_ISSUER="https://$AUTH_HOST" PORTAL_URL="https://$APP_HOST" \
  ZITADEL_BOOTSTRAP_PAT="$pat" node "$ROOT/deploy/local/zitadel-bootstrap.mjs" "$@"
ok "IDs em deploy/k8s/overlays/prod/zitadel.env (versionar no git)"
