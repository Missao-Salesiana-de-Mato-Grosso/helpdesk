#!/usr/bin/env bash
# Projeto "Help Desk", roles e app SPA no Zitadel de produção. Grava os IDs (não secretos) em
# deploy/k8s/overlays/prod/zitadel.env. O PAT vem do Secret iam-admin-pat e não é impresso.
source "$(dirname "$0")/lib.sh"

info "Bootstrap do Zitadel de produção"
pat=$(kctl -n zitadel get secret iam-admin-pat -o jsonpath='{.data.pat}' 2>/dev/null | base64 -d || true)
# Alternativa: PAT gerado no console para o usuário de serviço iam-admin (quando o Secret não foi gravado
# pelo setup), em secrets/zitadel.env. Ver docs/ambientes.md §2.4.
[[ -n "$pat" ]] || pat=$(read_secret zitadel.env ZITADEL_BOOTSTRAP_PAT)
[[ -n "$pat" ]] || die "Sem PAT: nem Secret iam-admin-pat no cluster, nem ZITADEL_BOOTSTRAP_PAT em $SECRETS_DIR/zitadel.env.
  Gere um PAT para o usuário de serviço iam-admin no console (docs/ambientes.md §2.4) e grave-o nesse arquivo."
BOOTSTRAP_TARGET=prod ZITADEL_ISSUER="https://$AUTH_HOST" PORTAL_URL="https://$APP_HOST" \
  ZITADEL_BOOTSTRAP_PAT="$pat" node "$ROOT/deploy/local/zitadel-bootstrap.mjs" "$@"
ok "IDs em deploy/k8s/overlays/prod/zitadel.env (versionar no git)"
