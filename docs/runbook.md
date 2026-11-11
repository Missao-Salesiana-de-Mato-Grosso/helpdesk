# Runbook de operação

Procedimentos do dia a dia e de emergência do Help Desk em produção (`https://suporte.msmt.org.br`). Quem
monta o ambiente segue `docs/ambientes.md`; este documento parte do ambiente já montado.

Convenções:

- 📘 = verificado em produção · ⚠️ = escrito a partir do código e da documentação, **ainda não executado em produção**. Ao executar um passo ⚠️ pela primeira vez, troque o símbolo e registre as armadilhas.
- Os comandos `make` rodam na raiz deste repositório, **numa janela do Terminal** (cada alvo pede confirmação `[s/N]`). Eles leem os segredos de `../msmt-infra-automation/secrets/` e usam o kubeconfig de lá, nunca o contexto atual do `kubectl`.
- Segredos nunca entram em chat, ticket, commit ou log. Este documento só cita **onde** cada um fica.

## 0. Referência rápida

| Situação                          | Seção |
| --------------------------------- | ----- |
| Publicar uma mudança              | 1     |
| Versão nova quebrou produção      | 2     |
| Perda ou corrupção de dados       | 3     |
| Pessoa nova vai atender (agente)  | 4     |
| Pessoa saiu da instituição        | 5     |
| Trocar uma senha ou chave         | 6     |
| Virada do e-mail e rollback       | 7     |
| E-mail com rótulo `helpdesk/erro` | 8     |
| Notificação que não chegou        | 9     |
| Rodar SQL em produção             | 10    |
| Tarefas com data marcada          | 11    |
| Unidade, setor, grupo, categoria  | 12    |
| Respostas prontas                 | 13    |
| Fechamento automático             | 14    |
| SLA: metas, horário e feriados    | 15    |
| Importar abertos do Freshdesk     | 16    |
| Caixa de outro setor (cadastros@) | 17    |

**Saúde:** `make status` (só leitura: pods, certificados, `https://auth.msmt.org.br/debug/ready` e `https://suporte.msmt.org.br/api/health`).

**Logs do app:** `kubectl --kubeconfig ../msmt-infra-automation/secrets/kubeconfig-k8s-msmt-prd.yaml -n helpdesk logs deployment/helpdesk --since=1h`. Os logs são JSON (pino), sem cabeçalhos, tokens nem corpo de mensagem (T18).

## 1. Deploy

**Caminho normal** 📘 (`docs/ci-cd.md`): issue → branch → Pull Request → CI `test` verde → merge na `main` → o job `deploy` espera a aprovação no ambiente `production` (GitHub → Actions → execução → **Review deployments**) → imagem `helpdesk:<sha curto>` publicada em `cr-msmt-prd`, migração (Job `helpdesk-migrate`: `prisma migrate deploy` + seed), rollout e checagem de `/api/health`.

Depois de aprovar:

1. Acompanhar o job até o fim. Se a **migração** falhar, o app em produção **não** é alterado (o rollout só roda depois do Job).
2. `make status`: `/api/health` = 200.
3. Abrir o portal numa aba anônima, entrar e abrir um ticket de teste se a mudança mexeu em tickets ou e-mail.
4. Se a mudança mexeu no front: console do navegador sem erro de CSP (T18).

**Contingência** (GitHub Actions fora do ar): `make deploy` 📘 no Terminal, com Docker Desktop aberto e `mgc` logado. Ele faz o mesmo que o job, a partir da sua cópia local: confira antes que está na `main` atualizada e sem alterações (`git status`), ou a imagem ganha o sufixo `-dirty`.

O app roda com **1 réplica** e estratégia `Recreate`: cada deploy tem alguns segundos de indisponibilidade. Os crons (outbox e IMAP) retomam do ponto em que pararam.

## 2. Rollback

Escolha pelo que a versão ruim mudou:

| A versão ruim…                        | Faça                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **não** tem migração nova             | Voltar a imagem anterior (2.1). Em seguida, reverter o PR (2.2) para a `main` não reimplantar o problema |
| tem migração **só aditiva**           | Igual: o código anterior ignora colunas e tabelas novas                                                  |
| tem migração que muda ou remove dados | **Não volte a imagem.** Corrija para frente (PR novo) ou, se houver perda de dados, vá para a seção 3    |

Para saber se houve migração: `git diff <sha anterior> <sha ruim> --stat -- apps/api/prisma/migrations`.

### 2.1 Voltar a imagem anterior ⚠️

- **Pelo GitHub:** Actions → workflow **CI/CD** → a execução da `main` que estava boa → **Re-run all jobs** → aprovar o `deploy`. O job refaz a imagem daquele commit e implanta.
- **Pelo Terminal** (mais rápido, sem build): `make deploy SKIP_BUILD=1 TAG=<sha curto bom>`. A tag é o `git rev-parse --short` do commit; as publicadas estão no registry `cr-msmt-prd` (painel da Magalu).

⚠️ O Job de migração roda também no rollback, com a pasta de migrações da versão antiga. Se o banco já tiver uma migração que a versão antiga não conhece, o `prisma migrate deploy` deve apenas não ter nada a aplicar; confirme no log do Job (`kubectl … -n helpdesk logs job/helpdesk-migrate`) antes de considerar o rollback concluído.

### 2.2 Reverter na `main`

GitHub → PR que introduziu o problema → **Revert** → abre um PR de reversão → CI → merge → deploy aprovado normalmente. Isso deixa a `main` igual ao que está em produção.

## 3. Backup e restore

**O que existe hoje:**

- **Banco** 📘: backup automático do DBaaS `pg-msmt-prd-web`, **7 dias de retenção, todo dia às 05:00 UTC** (01:00 em Cuiabá), com proteção contra exclusão (`msmt-infra-automation`, `make database`).
- **Anexos e e-mails brutos** 📘: bucket `msmt-helpdesk` com **versionamento** ligado (`attachments/` e `inbound/`). Um objeto apagado ou sobrescrito continua recuperável pela versão anterior.
- **A caixa `suporte@`** é o arquivo de segurança dos e-mails: a API só aplica rótulos, nunca apaga.
- **Decisão de 2026-11-05:** o snapshot diário do DBaaS é o backup do banco. O CronJob de `pg_dump` para `backups/` (etapa 9 de `docs/ambientes.md`) foi dispensado, então a única cópia do banco é a do DBaaS, na mesma conta da Magalu, com 7 dias de retenção.

### 3.1 Restaurar o banco ⚠️

Ainda **não testado** (teste previsto no encerramento do MVP, T23 de `docs/discovery/05-plano-mvp.md`). Roteiro para o primeiro uso, de preferência feito antes como teste, que deve ser feito **fora de uma emergência**:

1. Painel da Magalu → Database → `pg-msmt-prd-web` → Backups: escolher o ponto. Restaurar **para uma instância nova** (nunca por cima da atual), se o painel oferecer essa opção. Confirmar na [documentação do DBaaS](https://docs.magalu.cloud/) o comando equivalente do `mgc dbaas` e anotá-lo aqui.
2. Conferir os dados na instância restaurada por um pod `psql` (seção 10, trocando o host).
3. Para colocar em uso: trocar `DB_HOST` em `../msmt-infra-automation/secrets/database.env` **e** no secret `DB_HOST` do GitHub, e fazer o deploy (seção 1).
4. Tudo o que entrou depois do backup se perde no banco. Os e-mails do intervalo continuam na caixa: apagar `mailbox.last_uid` e `mailbox.uid_validity` em `app_settings` e definir `MAILBOX_START_SINCE` como a hora do backup faz a API relê-los. A idempotência por `Message-ID` impede duplicatas do que já estiver no banco restaurado.

### 3.2 Recuperar um anexo apagado ⚠️

Painel da Magalu → Object Storage → `msmt-helpdesk` → objeto (a chave está em `attachments.storage_key`) → versões → restaurar a anterior.

## 4. Criar um agente

O papel e o grupo se dão no **help desk** (T24, ADR-012). Sem grupo, o agente só vê os tickets atribuídos a ele.

1. A pessoa entra uma vez em `https://suporte.msmt.org.br` com a conta Google. Isso cria o usuário no Zitadel e no help desk.
2. **Dar o papel** ⚠️: portal → Administração → **Usuários** → buscar a pessoa → **Editar** → em **Papéis**, marcar `Agente` (ou `Supervisor`, `Administrador`) → **Salvar**. Vale na hora, sem a pessoa sair e entrar (T24).
   - Quem ganha papel é **liberado automaticamente** se ainda estava na fila de liberação (T22, RN-04).
   - Papel marcado como "Concedido no Zitadel" aparece travado: só sai pelo console do Zitadel.
   - Pelo Zitadel continua funcionando 📘 (para o 1º admin ou numa emergência): `make zitadel-bootstrap ARGS="--admin <email>"` concede `admin`; para os outros, `https://auth.msmt.org.br/ui/console` → Projetos → **Help Desk** → **Autorizações**. Esse caminho só vale depois que a pessoa sai e entra de novo.
3. **Pôr no grupo** ⚠️: portal → Administração → **Grupos** → escolher o grupo → acrescentar a pessoa em **Membros** → **Salvar membros**. Só aparecem agentes ativos. A mudança vale na hora (T15).

4. Pedir que a pessoa confira a fila "Do grupo" no portal.

Lembrete para o Workspace: agentes, supervisores e admins devem ter **verificação em 2 etapas obrigatória** (etapa 10 de `docs/ambientes.md`).

## 5. Desligar uma pessoa

Faça os três passos no mesmo dia. Desde o ADR-011 o login aceita qualquer conta Google, então **suspender no Workspace não basta** para quem entra com conta pessoal.

1. **Workspace** (contas `@missaosalesiana.org.br`): Admin do Google → Usuários → **Suspender**. A conta deixa de entrar no Google e, portanto, no Zitadel.
2. **Zitadel** ⚠️: console → Usuários → a pessoa → **Desativar**. Remova também as autorizações do projeto Help Desk.
3. **Help desk** ⚠️: portal → Administração → **Usuários** → buscar a pessoa → **Editar** → desmarcar **Ativo** e os **Papéis** concedidos no app → Salvar. A API passa a responder `403 USER_INACTIVE` já na próxima requisição, mesmo com token ainda válido, e a pessoa deixa de receber tickets e avisos de grupo. Ela some da tela de membros dos grupos; ao salvar os membros de um grupo, ela sai dele de vez.

4. Tickets atribuídos à pessoa: no portal, a fila "Todos" (supervisor) filtrada pelo responsável. Reatribuir um a um.

O histórico (mensagens, eventos) continua com o nome da pessoa. **Não apague o usuário.**

## 6. Rotação de segredos e senhas de app

Regra: o deploy pelo GitHub lê os **secrets do repositório** (Settings → Secrets and variables → Actions); o `make deploy` lê `../msmt-infra-automation/secrets/`. **Atualize os dois** em toda rotação, ou o próximo deploy volta o valor antigo.

| Segredo                                  | Onde se gera                                                                                                  | Atualizar em                                                                                   | Depois                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Senha de app de `suporte@` (SMTP e IMAP) | Conta Google de `suporte@` → Segurança → Senhas de app → criar nova; **revogar a antiga só depois do deploy** | `secrets/helpdesk-email.env` (`SMTP_PASSWORD`, `MAILBOX_PASSWORD`) e os mesmos nomes no GitHub | Deploy (seção 1). Conferir no log o ciclo da caixa e um envio   |
| Senha do banco `helpdesk`                | Trocar `DB_HELPDESK_PASSWORD` em `secrets/database.env`; `make database` no `msmt-infra-automation` aplica ⚠️ | Secret `DB_HELPDESK_PASSWORD` no GitHub                                                        | Deploy imediato: o app perde a conexão até o Secret novo chegar |
| Chave do Object Storage do app           | `msmt-infra-automation` (`make storage`) ⚠️ ou painel → Object Storage → chaves                               | `secrets/object-storage.env` e `S3_ACCESS_KEY`/`S3_SECRET_KEY` no GitHub                       | Deploy; testar download de um anexo; só então revogar a antiga  |
| Segredo do cliente OAuth do Google       | Google Cloud (`msmt-iam-zitadel`, conta `tecnologia@`) → Credenciais → `Zitadel produção` → redefinir segredo | Console do Zitadel → Configurações padrão → Provedores de identidade → Google                  | Testar login numa aba anônima                                   |
| `MGC_API_KEY` (pipeline)                 | Console da Magalu → API Keys                                                                                  | Secret do GitHub                                                                               | Re-run do último deploy para validar                            |
| `KUBECONFIG_PROD` (certificado de 1 ano) | `make cluster` no `msmt-infra-automation`                                                                     | Secret do GitHub (arquivo inteiro)                                                             | **Vence ~25/10/2027** (P11, seção 11)                           |
| Masterkey do Zitadel                     | **Nunca rotacionar.** Trocá-la torna os dados do Zitadel ilegíveis                                            | —                                                                                              | Manter `secrets/zitadel.env` no cofre                           |

## 7. Virada do e-mail e rollback

Fonte: `docs/discovery/05-plano-mvp.md` §5.4 e `docs/ambientes.md` §2.3. Pré-requisitos: P2, P3, P5, P6 e P7 de `docs/ambientes.md` §2.0 resolvidas, e a homologação feita com `suporte-teste@`.

⚠️ Regra que não se quebra: **a API nunca lê `suporte@` enquanto o Freshdesk estiver conectado à caixa** (os dois criariam tickets).

**Virada:**

1. **Preparar** (sem aplicar; ⚠️ os Secrets do GitHub entram no **próximo deploy, de qualquer merge**: deixe o PR do `MAIL_FROM` pronto e cadastre os Secrets só antes de mesclá-lo): em `../msmt-infra-automation/secrets/helpdesk-email.env` e nos secrets do GitHub, `SMTP_USER`/`MAILBOX_USER` = `suporte@missaosalesiana.org.br`, as senhas de app de `suporte@`, e `MAILBOX_START_SINCE` vazio por enquanto. Abrir (sem mesclar) um PR que volta `MAIL_FROM` para `Suporte MSMT <suporte@missaosalesiana.org.br>` em `deploy/k8s/overlays/prod/config.env`: na homologação ele é `suporte-teste@`, e o remetente precisa ser a caixa autenticada (o Gmail reescreve o `From` de outros endereços, e a proteção contra loop compara com `MAIL_FROM`).
2. **Zerar o cursor da caixa de teste** (seção 10), senão a API usaria o UID de `suporte-teste@` na caixa nova:

   ```sql
   DELETE FROM app_settings WHERE key IN ('mailbox.last_uid', 'mailbox.uid_validity');
   ```

3. **Desconectar a caixa no Freshdesk** (Admin → Canais → E-mail → `suporte@`; local exato: P7). **Anotar a hora**, com fuso: por exemplo `2026-11-03T07:15:00-04:00`.
4. Preencher `MAILBOX_START_SINCE` com essa hora (arquivo e GitHub) e mesclar o PR do `MAIL_FROM` do passo 1, o que dispara o deploy (seção 1).
5. **Conferir:** no log, `Cursor inicial da INBOX: UID …`; enviar um e-mail de fora para `suporte@` → ticket criado, rótulo `helpdesk/processado` no Gmail (e o e-mail continua na INBOX), confirmação chega no mesmo thread com `[#n]`.
6. Comunicar os colaboradores: nada muda, continuem escrevendo para `suporte@`; as respostas chegam com `[#número]`; o portal é `https://suporte.msmt.org.br`.
7. **Acompanhar por 2 h** (P8): consultas da seção 8 e da seção 9 a cada 15–30 min.

**Rollback da virada:**

1. Voltar `SMTP_USER`/`MAILBOX_USER` e as senhas para `suporte-teste@` (ou esvaziar `MAILBOX_USER` para desligar a leitura), reverter o PR do `MAIL_FROM` e fazer o deploy.
2. Zerar o cursor de novo (passo 2 da virada).
3. **Reconectar a caixa no Freshdesk.** Como a API nunca apaga nem arquiva, o Freshdesk enxerga tudo o que chegou.
4. Tickets criados no help desk durante o intervalo continuam lá e são atendidos lá.

## 8. E-mails com rótulo `helpdesk/erro`

Cada e-mail lido gera uma linha em `inbound_emails`. `failed` = erro ao processar (rótulo `helpdesk/erro` no Gmail); `discarded` = descartado de propósito pelo anti-loop (rótulo `helpdesk/descartado`).

Consultar (seção 10):

```sql
SELECT created_at, status, reason, from_email, subject, imap_uid, ticket_id
FROM inbound_emails
WHERE status IN ('failed', 'discarded') AND created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

| `status` · `reason`                                            | O que fazer                                                                                                                                                                                  |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discarded` · `auto_submitted`, `bulk`, `auto_reply`, `bounce` | Esperado (auto-resposta, lista, aviso de entrega). Nada a fazer                                                                                                                              |
| `discarded` · `own_address`                                    | E-mail da própria caixa (anti-loop). Esperado                                                                                                                                                |
| `discarded` · `rate_limited`                                   | Mais de 20 e-mails do remetente na hora: costuma ser loop ou disparo em massa. Ler na caixa; se for legítimo, abrir o ticket pelo portal em nome do remetente                                |
| `discarded` · `dmarc_fail`                                     | O remetente não passou no DMARC: possível falsificação. Ler o original no Gmail ("Mostrar original"); se for legítimo, abrir pelo portal e avisar o remetente do problema no domínio         |
| `discarded` · `inactive_sender`                                | Usuário inativado (seção 5). Se ainda precisa de atendimento, reativar ou abrir pelo portal                                                                                                  |
| `failed` · `parse_error`, `no_sender`                          | E-mail ilegível ou sem remetente. Ler o original no Gmail; se for um pedido real, abrir o ticket pelo portal em nome do remetente                                                            |
| `failed` · outro texto (ex.: categoria "Geral" ausente)        | Erro de regra. A tela não deixa desativar nem renomear a "Geral" (T25), e o seed a recria se faltar: o próximo deploy roda o seed (Job de migração). Corrigida a causa, reprocessar (abaixo) |
| nenhuma linha, e-mail parado na INBOX sem rótulo               | Falha de infraestrutura (banco, storage, IMAP): a API não grava `failed` e tenta de novo no próximo ciclo. Ver o log (`Ciclo da caixa interrompido`)                                         |

**Reprocessar um e-mail `failed`** ⚠️ (depois de corrigir a causa). A idempotência é por `Message-ID`, então é preciso remover a linha e recuar o cursor até antes do UID dele (seção 10):

```sql
BEGIN;
DELETE FROM inbound_emails WHERE id = '<id>' AND status = 'failed' RETURNING imap_uid;
UPDATE app_settings SET value = '<imap_uid - 1>' WHERE key = 'mailbox.last_uid';
COMMIT;
```

No próximo ciclo (até 1 min), a API relê a partir dali. Os e-mails seguintes que já tinham sido processados aparecem como `duplicate` no log e não geram nada novo. Remova o rótulo `helpdesk/erro` do e-mail no Gmail depois que ele virar ticket.

## 9. Notificação que não chegou

A saída passa pela outbox (`notifications`): até 6 tentativas com espera crescente (1, 2, 4… min); erro permanente de SMTP desiste na hora.

```sql
SELECT created_at, template, to_email, status, attempts, last_error, send_after
FROM notifications
WHERE status <> 'sent' AND created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

- `pending` com `attempts` subindo: SMTP fora ou senha de app inválida (`last_error` mostra o código, sem conteúdo). Corrigir a causa (seção 6); a fila retoma sozinha.
- `failed`: desistiu. ⚠️ Para reenviar depois de corrigir: `UPDATE notifications SET status = 'pending', attempts = 0, send_after = now() WHERE id = '<id>';`
- Lembrete: o Workspace limita a cerca de 2.000 envios por dia.

## 10. Rodar SQL em produção

O banco só é alcançável de dentro do cluster (rede privada). Use um pod `psql` temporário, como o `make database` faz ⚠️. A senha vai pela entrada padrão, nunca pela linha de comando:

```bash
cd ../msmt-infra-automation
source <(grep -E '^(DB_HOST|DB_HELPDESK_PASSWORD)=' secrets/database.env | sed 's/^/export /')
{ printf '%s\n' "$DB_HELPDESK_PASSWORD"; cat consulta.sql; } |
  kubectl --kubeconfig secrets/kubeconfig-k8s-msmt-prd.yaml run "psql-$(date +%s)" --rm -i --restart=Never \
    --quiet --image=postgres:17-alpine -- \
    sh -c 'IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql "host='"$DB_HOST"' user=helpdesk dbname=helpdesk sslmode=prefer" -v ON_ERROR_STOP=1'
unset DB_HOST DB_HELPDESK_PASSWORD
```

Regras:

- Escrita sempre dentro de `BEGIN; … COMMIT;`, com o `WHERE` conferido antes por um `SELECT`.
- **Nunca** `UPDATE` ou `DELETE` em `ticket_events` (append-only).
- Não selecione `body_html`, `quoted_html` nem conteúdo de anexo sem necessidade: são dados pessoais (LGPD).

## 11. Tarefas com data marcada

| Quando                   | Tarefa                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Até 08/11/2026           | Export completo do Freshdesk (conta + API) e cancelamento (05-plano §5.4, passo 8)                  |
| No encerramento do MVP   | Cópia de `msmt-infra-automation/secrets/` num cofre e **teste de restore** do DBaaS (T23, §3.1)     |
| **Antes de 25/10/2027**  | Renovar o kubeconfig do `k8s-msmt-prd` (`make cluster` no infra) e o secret `KUBECONFIG_PROD` (P11) |
| A cada 30 dias (sozinho) | Pedidos de acesso sem decisão vão para a lixeira (T22, RN-19). Conferir a lixeira no portal         |
| Mensal (sugestão)        | Olhar `inbound_emails` `failed` e `notifications` `failed` do mês (seções 8 e 9)                    |

## 12. Unidades, departamentos, grupos e categorias

Portal → **Administração** → **Unidades**, **Departamentos**, **Grupos** ou **Categorias** (só admin, T25). Em cada tela: **Novo** cria; **Editar** renomeia ou desativa. A mudança vale na hora.

- **Não existe excluir.** Desativar tira o item das listas de escolha (1º acesso, novo ticket, painel do agente); quem já usa continua com ele, e o histórico não muda. Para corrigir um nome, **renomeie**: os vínculos com usuários e tickets ficam.
- **Nome repetido** é recusado, sem diferenciar maiúsculas.
- **Grupo:** o e-mail de aviso é opcional e recebe o aviso de ticket novo além dos membros (T14). Os membros continuam na mesma tela, em **Membros**. Não dá para desativar o grupo padrão de uma categoria ativa: troque o grupo padrão dela ou desative-a antes.
- **Categoria "Geral":** recebe os tickets abertos por e-mail (T21). Não pode ser renomeada nem desativada; só o grupo padrão muda.
- **Seed:** o Job de migração roda `prisma/seed.ts` a cada deploy, mas ele só preenche uma tabela **vazia** (instalação nova) e garante a "Geral". O que for mudado pela tela não volta no deploy seguinte.

## 13. Respostas prontas

Portal → **Supervisão** → **Respostas prontas** (admin e supervisor, T26): **Nova resposta**, **Editar** e, dentro do modal, **Excluir resposta** (pede confirmação). Excluir não muda as mensagens já enviadas: o texto é copiado para a mensagem na hora de inserir.

- O agente usa no ticket, nas abas **Resposta** e **Nota interna**: campo **Inserir resposta pronta…**, com busca pelo título. O texto entra na posição do cursor e pode ser editado antes de enviar.
- Variáveis trocadas ao inserir: `{{solicitante}}` (primeiro nome do solicitante), `{{numero}}` (`#1234`) e `{{agente}}` (primeiro nome de quem responde). Variável escrita errada fica como está, para o agente notar.
- Título repetido é recusado, sem diferenciar maiúsculas.

## 14. Fechamento automático

Uma rotina da API roda a cada hora e passa para **Fechado** o ticket que está em **Resolvido** há mais de `AUTO_CLOSE_DAYS` dias (padrão **7**), contados da última resolução (T27). Se o solicitante responder antes, o ticket volta para Aberto e a contagem recomeça na próxima resolução.

- No histórico aparece "Sistema fechou o chamado automaticamente". O solicitante não recebe e-mail. Resposta depois disso abre um ticket novo, relacionado ao anterior (T21).
- Mudar o prazo: variável `AUTO_CLOSE_DAYS` em `deploy/k8s/overlays/prod/config.env` (por PR, como qualquer mudança). `0` desliga a rotina.
- Cada ciclo fecha no máximo 200 tickets; o resto fica para a hora seguinte. No log, `Fechamento automático: N ticket(s)...`. Se aparecer `Ator do sistema ... ausente`, o seed não rodou (ele roda no Job de migração a cada deploy).

## 15. SLA: metas, horário e feriados

Portal → **Administração** → **SLA** (só admin, T28). Três blocos, cada um com o próprio **Salvar**:

- **Metas por prioridade:** 1ª resposta e resolução, em **horas úteis** (com o horário padrão, 1 dia útil = 8 h). Padrão do seed: urgente 1 h / 4 h, alta 4 h / 8 h, média 8 h / 24 h, baixa 16 h / 40 h.
- **Horário comercial:** intervalos por dia, separados por vírgula (`07:00–11:00, 13:00–17:00`); em branco = fechado. O fuso é `BUSINESS_TIMEZONE` (`America/Cuiaba`), não o do navegador.
- **Feriados:** um calendário único para todas as unidades; o dia todo fica fora do horário útil. O seed traz só os **nacionais de 2026 e 2027**: cadastre os estaduais, os municipais e os pontos facultativos que a Missão adota, e **todo fim de ano os do ano seguinte**.

Como conta:

- O prazo corre só em horário útil, a partir da abertura. **Pendente, resolvido e fechado pausam** o relógio; quando o ticket volta para aberto, as horas úteis pausadas são somadas ao prazo. Trocar a prioridade recalcula pela nova meta.
- Salvar qualquer bloco recalcula os prazos dos tickets **não fechados**. Os fechados guardam o prazo que tinham.
- Tickets de antes da T28 ganharam prazo no primeiro deploy, contado da abertura e sem descontar pausas anteriores (o histórico de pausas não existia). Os que estavam pendentes, resolvidos ou fechados ficaram pausados desde a resolução (ou, sem ela, a última atualização).
- Só agentes veem o SLA. Na fila: coluna **Prazo** (a 1ª resposta enquanto não houver, depois a resolução), botão **SLA vencido (n)** (abertos com prazo estourado, do escopo do agente) e a ordenação **Prazo de resolução mais próximo**. No ticket, o quadro **SLA** mostra as duas metas.
- Não há alerta por e-mail nem escalonamento (Fase 2, depois).

## 16. Importar os chamados abertos do Freshdesk

Uso único (T29). Traz só os chamados **abertos e pendentes** do export, com mensagens, notas internas, anexos e as imagens coladas. Entram com a data e os autores originais, um número novo daqui e o evento "importou do Freshdesk (chamado #N de lá)". Não envia e-mail. O SLA conta a partir da importação. Rodar de novo não duplica (o número de lá fica em `custom_fields.freshdeskId`).

**Antes:** a T29 em produção (a imagem precisa ter `dist/import`) e os grupos de destino criados (padrão: `Cadastros` para o grupo "Cadastro de Clientes e Fornecedores" e para o que foi para `cadastros@`; `Suporte TI` para os grupos de suporte; o resto vai para o grupo padrão da categoria "Geral").

1. **Pacote** (na máquina que tem o export, **com o Freshdesk ainda ativo**, porque as imagens coladas são baixadas de lá): `node scripts/freshdesk-bundle.mjs` → `~/freshdesk-bundle`. Depois: `tar -C ~ -czf ~/freshdesk-bundle.tgz freshdesk-bundle`.
2. **Pod temporário** (com o mesmo ambiente da API; o banco só é alcançável de dentro do cluster):

   ```bash
   K="kubectl --kubeconfig ../msmt-infra-automation/secrets/kubeconfig-k8s-msmt-prd.yaml -n helpdesk"
   IMAGE=$($K get deployment helpdesk -o jsonpath='{.spec.template.spec.containers[0].image}')
   sed "s|IMAGE|$IMAGE|" deploy/k8s/jobs/freshdesk-import-pod.yaml | $K apply -f -
   $K wait --for=condition=Ready pod/helpdesk-import --timeout=120s
   # Caminho relativo: no Windows, um absoluto (C:/...) faz o kubectl ler "C" como nome de pod.
   KC=$(realpath ../msmt-infra-automation/secrets/kubeconfig-k8s-msmt-prd.yaml)
   (cd ~ && kubectl --kubeconfig "$KC" -n helpdesk cp freshdesk-bundle.tgz helpdesk-import:/tmp/bundle.tgz)
   $K exec helpdesk-import -- tar -xzf /tmp/bundle.tgz -C /tmp
   ```

3. **Simular** (não grava nada): `$K exec helpdesk-import -- node dist/import/freshdesk-import.js /tmp/freshdesk-bundle`. Uma linha por chamado (só número de lá, situação, grupo, contagens), os **possíveis duplicados** (mesmo solicitante e assunto, aberto do dia anterior a 3 dias depois: o `suporte@` encaminhou para o Freshdesk depois da virada) e os grupos que faltam. Conferir cada duplicado no portal pelo número indicado.
4. **Gravar:** o mesmo comando com `--apply`. Duplicados são pulados; para importar algum mesmo assim, `--keep 18101,18150` (os números de lá que a simulação apontou). Outro destino de grupo: `--map-group "Nome lá=Nome aqui"` ou `--map-mailbox "caixa@missaosalesiana.org.br=Grupo"`.
5. **Limpar:** `$K delete pod helpdesk-import` (some sozinho em 2 h) e, conferido o resultado, apagar `~/freshdesk-bundle` e `~/freshdesk-bundle.tgz` (dados pessoais). Registrar a execução em `docs/ambientes.md`.

Detalhes: prioridade "baixa" de lá (o padrão, quase todos) vira média; contatos novos entram como no canal de e-mail (sem login, terceiro fora do domínio institucional); o responsável só é mantido se for agente ativo aqui; anexos fora das regras (tipo, 20 MB) ficam listados no texto da mensagem; imagens coladas viram anexo, com um aviso no lugar.

## 17. Caixa de outro setor (ex.: `cadastros@`)

O app lê só a caixa `suporte@`. Outra caixa entra **encaminhando** para ela: o e-mail novo enviado para a caixa do setor abre o ticket no grupo que tem essa **caixa de entrada** (o app reconhece o destino pelo `To`/`Cc` ou pelos cabeçalhos do encaminhamento). Respostas a tickets existentes seguem pelo `[#n]`, como sempre. Confirmação e respostas saem de `suporte@`.

1. **Grupo:** Administração → Grupos → editar o grupo (ex.: Cadastros) → **Caixa de entrada**: `cadastros@missaosalesiana.org.br`. Fazer **antes** do passo 2; sem isso, os e-mails caem no grupo padrão da categoria "Geral". O grupo precisa ter agentes como membros.
2. **Encaminhamento** (logado na caixa do setor, no Gmail): Configurações → Ver todas as configurações → **Encaminhamento e POP/IMAP** → Adicionar um endereço de encaminhamento → `suporte@missaosalesiana.org.br`. O Google manda um código de confirmação para `suporte@`: ele vira um ticket no grupo padrão da "Geral" (ou abra no Gmail de `suporte@`); copie o código e feche esse ticket. Depois, marque **Encaminhar uma cópia dos e-mails recebidos para** `suporte@` e **arquivar a cópia do Gmail** (o atendimento passa a ser só no help desk). Se a opção não aparecer, o encaminhamento automático está bloqueado no Admin Console (Gmail → Configurações do usuário final → Encaminhamento automático).
3. **Freshdesk:** o Gmail encaminha para um endereço só. Se a caixa encaminhava para o Freshdesk, o passo 2 troca o destino; se o Freshdesk lia a caixa por conta própria, desconectar lá, para não abrir o chamado nos dois.
4. **Testar:** de uma conta de fora, mandar um e-mail para a caixa do setor. Em até 1 min: ticket no grupo, aviso aos membros e confirmação `[#n]` para o remetente. Se não aparecer, ver o motivo em `inbound_emails` (§10; ex.: `dmarc_fail`) e o rótulo `helpdesk/erro` no Gmail de `suporte@` (§8).

Para desligar: apagar a caixa de entrada do grupo e o encaminhamento no Gmail.
