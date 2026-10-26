#!/usr/bin/env bash
# Só leitura: pods, certificados e saúde do Zitadel e do Help Desk.
source "$(dirname "$0")/lib.sh"
for ns in zitadel helpdesk; do
  info "$ns"
  kctl -n "$ns" get pods,certificates 2>/dev/null || warn "namespace $ns sem recursos"
done
for url in "https://$AUTH_HOST/debug/ready" "https://$APP_HOST/api/health"; do
  printf '%s → %s\n' "$url" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)"
done
