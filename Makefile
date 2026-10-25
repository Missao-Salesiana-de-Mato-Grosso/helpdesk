# Produção (T17). Executado pelo desenvolvedor num Terminal (cada alvo pergunta antes de alterar).
# Plataforma (cluster, banco, bucket, Traefik): repositório irmão ../msmt-infra-automation.
# Segredos: ../msmt-infra-automation/secrets/ (fora do git). Passo a passo: docs/ambientes.md §2.4.
.PHONY: help zitadel zitadel-bootstrap deploy status

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

zitadel: ## Zitadel em https://auth.msmt.org.br (Secrets + Helm + certificado)
	@deploy/prod/zitadel.sh

zitadel-bootstrap: ## Projeto, roles e app SPA no Zitadel; grava os IDs no overlay de produção
	@deploy/prod/zitadel-bootstrap.sh $(ARGS)

deploy: ## Build/push da imagem, Secrets, migração e rollout em https://suporte.msmt.org.br
	@deploy/prod/app.sh

status: ## Pods, certificados e saúde (só leitura)
	@deploy/prod/status.sh
