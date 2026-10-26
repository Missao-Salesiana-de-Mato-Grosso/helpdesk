#!/usr/bin/env bash
# Funções comuns do deploy de produção (T17). Executado pelo desenvolvedor (`make ...` na raiz),
# nunca pelo Claude Code. Segredos ficam em ../msmt-infra-automation/secrets/ (fora do git) e nunca são
# impressos. kubectl e helm usam sempre o kubeconfig do cluster de produção, nunca o contexto atual.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="${INFRA_DIR:-$ROOT/../msmt-infra-automation}"
SECRETS_DIR="$INFRA_DIR/secrets"
KUBECONFIG_FILE="$SECRETS_DIR/kubeconfig-k8s-msmt-prd.yaml"
# Região explícita em todo comando mgc: o padrão do CLI (mgc config) pode estar em outra (ex.: br-ne1),
# e o usuário/credencial do registry é por região.
MGC_REGION=br-se1
REGISTRY_HOST=container-registry.${MGC_REGION}.magalu.cloud
IMAGE_REPO="$REGISTRY_HOST/cr-msmt-prd/helpdesk"
ZITADEL_CHART_VERSION=10.4.0
APP_HOST=suporte.msmt.org.br
AUTH_HOST=auth.msmt.org.br

if [[ -t 1 ]]; then
  BOLD=$'\e[1m' RED=$'\e[31m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RESET=$'\e[0m'
else
  BOLD='' RED='' GREEN='' YELLOW='' RESET=''
fi
info() { printf '%s\n' "${BOLD}==>${RESET} $*"; }
ok() { printf '%s\n' "${GREEN}✔${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}⚠${RESET} $*" >&2; }
die() {
  printf '%s\n' "${RED}✘${RESET} $*" >&2
  exit 1
}

confirm() {
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  [[ -t 0 ]] || die "Confirmação necessária, mas não há terminal interativo: $*
  Rode numa janela do Terminal ou repita com ASSUME_YES=1."
  local answer
  read -r -p "${BOLD}$* [s/N]${RESET} " answer
  [[ "$answer" =~ ^[sS]$ ]] || die "Cancelado."
}

[[ -d "$SECRETS_DIR" ]] || die "Pasta de segredos não encontrada: $SECRETS_DIR (repositório msmt-infra-automation)."
[[ -f "$KUBECONFIG_FILE" ]] || die "Kubeconfig não encontrado: $KUBECONFIG_FILE. Rode no infra: make cluster"

kctl() { kubectl --kubeconfig "$KUBECONFIG_FILE" "$@"; }
hlm() { helm --kubeconfig "$KUBECONFIG_FILE" "$@"; }

read_secret() {
  local file="$SECRETS_DIR/$1" key="$2"
  [[ -f "$file" ]] || return 0
  sed -n "s/^${key}=//p" "$file" | tail -1
}

require_secret() {
  local value
  value=$(read_secret "$1" "$2")
  [[ -n "$value" ]] || die "Falta $2 em $SECRETS_DIR/$1."
  printf '%s' "$value"
}

write_secret() {
  local file="$SECRETS_DIR/$1" key="$2" value="$3"
  touch "$file"
  chmod 600 "$file"
  grep -v "^${key}=" "$file" >"$file.tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$file.tmp"
  mv "$file.tmp" "$file"
  chmod 600 "$file"
}

random_alnum() { openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

# Aplica um Secret genérico a partir de pares chave=valor lidos da entrada padrão (um por linha),
# sem passar valores pela linha de comando.
apply_env_secret() {
  local namespace="$1" name="$2"
  kctl -n "$namespace" create secret generic "$name" --from-env-file=/dev/stdin \
    --dry-run=client -o yaml | kctl apply -f - >/dev/null
}

# Lê um valor de um .env do overlay de produção (não secreto, versionado).
overlay_value() {
  sed -n "s/^$1=//p" "$ROOT/deploy/k8s/overlays/prod/zitadel.env" | tail -1
}
