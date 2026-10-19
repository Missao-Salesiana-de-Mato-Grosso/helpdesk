# Discovery — Help Desk Interno MSMT

> Missão Salesiana de Mato Grosso · Discovery executado em 19/10/2026 (segunda-feira)
> Portal no ar: **sáb 24/10** · Virada do e-mail `suporte@`: **ter 27/10** · Freshdesk ativo até ~08/11 · Time: 1 desenvolvedor + Claude Code

## Documentos

| #   | Documento                                            | Conteúdo                                                                                      |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | [01-escopo.md](01-escopo.md)                         | Matriz de escopo (MVP / Fase 2 / Fora), regras do canal de e-mail, matriz de permissões       |
| 2   | [02-identidade-zitadel.md](02-identidade-zitadel.md) | Zitadel + Google Workspace: estrutura, login, autorização, usuários                           |
| 3   | [03-arquitetura.md](03-arquitetura.md)               | Arquitetura, processamento de e-mail, infraestrutura Magalu Cloud, diagramas, modelo de dados |
| 4   | [04-lgpd.md](04-lgpd.md)                             | Adequação à LGPD                                                                              |
| 5   | [05-plano-mvp.md](05-plano-mvp.md)                   | Plano dia a dia, backlog para o Claude Code, plano de virada do e-mail, riscos                |
| 6   | [06-perguntas-abertas.md](06-perguntas-abertas.md)   | Respostas obtidas e o que ainda falta                                                         |
| 7   | [adr/](adr/)                                         | Registros de decisão de arquitetura (ADR-001 a ADR-010)                                       |
| —   | [../../CLAUDE.md](../../CLAUDE.md)                   | Instruções do projeto para o Claude Code                                                      |

## Resumo executivo

**O que é:** um help desk interno substituindo o Freshdesk para cerca de 20 agentes e 500 tickets/mês. Os solicitantes são colaboradores da Missão, autenticados pela conta Google institucional através do Zitadel self-hosted.

**Como o suporte funciona hoje, e vai continuar:** o colaborador escreve para `suporte@missaosalesiana.org.br`, isso abre um ticket, ele recebe as respostas por e-mail e pode acompanhar pelo portal. **O e-mail é o canal principal.** Terceiros (pessoas de fora da Missão) só interagem por e-mail e nunca acessam o portal.

**Veredito sobre o prazo:** o escopo completo de paridade com o Freshdesk não cabe em 5 dias com 1 desenvolvedor. E, como o e-mail é o canal principal, a abertura de tickets por e-mail **não pode ficar para a Fase 2**: entra no MVP e custa cerca de 1,5 dia a mais. Por isso o plano passa a ter duas datas:

- **Sábado 24/10:** portal e login no ar, para os agentes testarem (soft launch).
- **Terça 27/10:** virada do `suporte@` (remove-se o encaminhamento para o Freshdesk). Esta é a data que importa para o usuário final.

O Freshdesk segue até ~08/11 só concluindo os tickets antigos, o que dá margem segura. Se preferir manter 24/10 como data única, o custo é entrar no ar **sem** o canal de e-mail, o que contraria o hábito de todo mundo. Não recomendo.

**MVP:** login Google via Zitadel; e-mail para `suporte@` vira ticket e a resposta por e-mail cai no mesmo ticket; portal para abrir e acompanhar; filas por grupo com filtro por unidade; respostas públicas e notas internas; anexos (por e-mail e pelo portal); histórico auditável; notificações por e-mail com threading. Unidades, departamentos, grupos e categorias entram por seed.

**Fase 2 (semanas seguintes):** telas de administração, respostas prontas, SLA, automações, relatórios, base de conhecimento, CSAT, round-robin, migração do histórico (se um dia for desejada).

**Decisões principais:**

1. **Monólito modular** NestJS que também serve o build do React. Uma imagem, um domínio, nenhum CORS. Monorepo pnpm.
2. **Zitadel com o Google Workspace como Identity Provider.** 1 Organization, 1 Project, 1 aplicação SPA (PKCE). Ninguém é cadastrado à mão: a conta nasce no primeiro "Entrar com Google". Roles `admin`, `supervisor` e `agente`; quem não tem role é solicitante. Terceiros nunca entram no Zitadel.
3. **Validação local do JWT via JWKS** no NestJS (token do tipo JWT na app do Zitadel). Usuários provisionados **JIT** no login; usuários criados por e-mail são vinculados pelo endereço no primeiro login.
4. **Login hospedado** pelo Zitadel (Login V2, Helm chart v9). Sem tela de login própria, sem gestão de senha.
5. **E-mail de entrada por IMAP** na caixa `suporte@missaosalesiana.org.br` (Gmail, senha de app), com polling de 1 min. Threading por `Message-ID`/`In-Reply-To` com fallback pela tag `[#1234]` no assunto. Saída por SMTP do Gmail com os mesmos cabeçalhos.
6. **Magalu Cloud:** Kubernetes gerenciado, PostgreSQL via DBaaS (bancos separados para Zitadel e help desk), Object Storage para anexos e `.eml` brutos, Traefik e cert-manager. **Contingência:** VM com Docker Compose se o cluster não estiver pronto no fim do dia 1.
7. **Sem Redis, filas, WebSocket ou motor de busca** no MVP. Polling, locking otimista, `@nestjs/schedule` e tabelas _outbox_ (saída) e _inbox_ (entrada).

**Maiores riscos:** (a) infraestrutura do Zitadel no Kubernetes consumir mais de 1 dia; (b) a virada da caixa `suporte@` gerar duplicidade ou perda de e-mails, o que é mitigado por testar antes numa caixa `suporte-teste@` e por fazer a virada removendo o encaminhamento, com rollback imediato.

**Ação imediata:** criar a caixa `suporte-teste@missaosalesiana.org.br` e responder às 3 perguntas restantes de [06-perguntas-abertas.md](06-perguntas-abertas.md), em especial se `suporte@` é uma caixa de usuário ou um Grupo do Google.

## Respostas obtidas em 19/10

| Pergunta                             | Resposta                                                                                              | Efeito no plano                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Zitadel já instalado?                | **Não**                                                                                               | Instalação no caminho crítico dos dias 1 e 2                                                   |
| Provedor de e-mail                   | **Google Workspace** (`missaosalesiana.org.br`)                                                       | Google vira o IdP do Zitadel. Federação no MVP                                                 |
| SMTP                                 | **Gmail**, conta `suporte@missaosalesiana.org.br`                                                     | Senha de app (verificação em 2 etapas). Mesma caixa serve a entrada via IMAP                   |
| Canal atual                          | **E-mail para `suporte@` abre o ticket**; interações seguem por e-mail; portal para consulta          | Abertura por e-mail e threading entram no MVP. Go-live em duas datas                           |
| Terceiros                            | Respondem **só por e-mail**, nunca acessam o portal; marcados no cadastro                             | Flag `is_external` no usuário; criados automaticamente quando o remetente é de domínio externo |
| Unidade                              | Todo usuário com acesso está vinculado a uma unidade                                                  | Tela de 1º acesso obrigatória; usuários criados por e-mail ficam "sem unidade" até a triagem   |
| Google Cloud Console e senhas de app | Acesso e permissão OK                                                                                 | —                                                                                              |
| DNS                                  | O próprio desenvolvedor administra                                                                    | —                                                                                              |
| Magalu Cloud                         | Conta ativa                                                                                           | —                                                                                              |
| Domínio do app                       | `suporte.msmt.org.br` (app) e `auth.msmt.org.br` (Zitadel, premissa)                                  | —                                                                                              |
| Licença do Freshdesk                 | Vence em ~20 dias (~08/11/2026)                                                                       | ~2 semanas de convivência. Exportar antes de cancelar                                          |
| Migração do histórico                | Não agora                                                                                             | Fora do plano. Só o export de segurança                                                        |
| Estrutura                            | Agentes, **empresas** (= unidades/escolas), **departamentos**; permissões básicas por usuário e grupo | `companies` e `departments` no MVP                                                             |
| DPO                                  | Samuel Rees (DataGuardian)                                                                            | Validar base legal e aviso de privacidade                                                      |

## Premissas que continuam valendo

- O domínio institucional do Workspace é `missaosalesiana.org.br`. Se `msmt.org.br` também for domínio do Workspace, as contas dos dois funcionam: um app OAuth "Internal" aceita qualquer domínio da organização.
- `suporte@missaosalesiana.org.br` é uma **caixa de usuário** do Gmail (não um Grupo do Google). ⚠️ Confirmar: IMAP só funciona em caixa de usuário.
- Hoje a caixa `suporte@` encaminha para um endereço do Freshdesk. A virada consiste em remover esse encaminhamento.
- Agentes respondem pelo portal. Se um agente responder ao e-mail de notificação a partir da própria conta, o sistema reconhece e registra como resposta pública dele (regra barata, incluída no MVP).
- A interface é em pt-BR, e o código e os identificadores ficam em inglês.
- Versão do Zitadel: **v4.19.5** (a mais recente em 15/10/2026). O Zitadel **não possui canal LTS**: as versões saem continuamente na linha 4.x. Fixe a versão explicitamente no Helm.
