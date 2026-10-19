# 6. Perguntas em aberto

Atualizado em 19/10/2026, após a segunda rodada de respostas.

## Respondidas

| #   | Pergunta                                       | Resposta                                                                                                   | Onde foi aplicada                                                         |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | Zitadel já instalado?                          | Não                                                                                                        | Caminho crítico dos dias 1 e 2                                            |
| 2   | Google Workspace ou Microsoft 365?             | Google Workspace                                                                                           | IdP Google no Zitadel (02-identidade)                                     |
| 3a  | SMTP                                           | Gmail, `suporte@missaosalesiana.org.br`                                                                    | 03-arquitetura, R11                                                       |
| 3b  | Canal atual                                    | **E-mail para `suporte@` abre o ticket**; demais interações por e-mail; portal para consulta               | Abertura por e-mail no MVP (01-escopo, 03-arquitetura §3.3, ADR-010, T21) |
| 4   | Conta Magalu ativa?                            | Sim                                                                                                        | —                                                                         |
| 5a  | Domínio                                        | `suporte.msmt.org.br`                                                                                      | 03-arquitetura. Premissa: Zitadel em `auth.msmt.org.br`                   |
| 5b  | Quem cria registros DNS?                       | O próprio desenvolvedor                                                                                    | —                                                                         |
| 6a  | Licença do Freshdesk                           | Vence em ~20 dias (~08/11)                                                                                 | Duas datas de go-live (05-plano §5.1)                                     |
| 6b  | Migrar o histórico?                            | Não agora                                                                                                  | Fora do plano. Só o export de segurança (R6)                              |
| 7   | Estrutura                                      | Agentes, empresas (= unidades), departamentos; permissões básicas                                          | `companies` e `departments` no MVP                                        |
| 8   | DPO                                            | Samuel Rees, DataGuardian                                                                                  | 04-lgpd                                                                   |
| 9   | Agentes atendem várias escolas?                | Sim                                                                                                        | Filtro por unidade nas filas                                              |
| 10  | Interpretação de empresa e departamento        | Confirmada. Terceiros só por e-mail, sem acesso, marcados no cadastro. Todo usuário com acesso tem unidade | `is_external`, tela de 1º acesso, triagem "sem unidade"                   |
| 11  | Acesso ao Google Cloud Console e senhas de app | Sim                                                                                                        | —                                                                         |

## Ainda em aberto

| #   | Pergunta                                                                                                                                                                 | Por que importa                                                                                                                            | Prazo        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 12  | `suporte@missaosalesiana.org.br` é uma **caixa de usuário** do Gmail ou um **Grupo do Google**?                                                                          | IMAP só funciona em caixa de usuário. Se for grupo, é preciso criar uma caixa `helpdesk@` que receba o grupo e envie como `suporte@` (R10) | **Hoje**     |
| 13  | Como `suporte@` chega ao Freshdesk hoje: encaminhamento configurado no próprio Gmail, roteamento no admin do Workspace, ou o Freshdesk lê a caixa? A caixa guarda cópia? | Define o passo 5 da virada e o rollback (05-plano §5.4)                                                                                    | Quarta 21/10 |
| 14  | Hoje os agentes respondem **pelo Freshdesk** ou **pelo próprio e-mail**?                                                                                                 | Se respondem pelo e-mail, a regra "agente respondendo por e-mail = resposta pública" sobe de prioridade e sai da lista de cortes           | Quarta 21/10 |
| 15  | Existem **outras caixas** além de `suporte@` que abrem tickets (ex.: por unidade ou por setor)?                                                                          | Cada caixa extra é só configuração, mas precisa ser conhecida antes da virada                                                              | Quarta 21/10 |
| 16  | `msmt.org.br` também é domínio do Workspace, ou só `missaosalesiana.org.br`?                                                                                             | Define `INTERNAL_EMAIL_DOMAINS` (quem é "interno" x "terceiro")                                                                            | Quarta 21/10 |

## Para decidir depois (não bloqueia)

- Onde o repositório ficará hospedado (GitHub, Azure DevOps, GitLab), para o CI/CD da Fase 2.
- Precisa de app móvel? A premissa é que não: a SPA é responsiva.
- Precisa de multi-idioma? A premissa é que não: só pt-BR.
