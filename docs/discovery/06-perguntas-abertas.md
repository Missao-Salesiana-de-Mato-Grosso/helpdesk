# 6. Perguntas em aberto

Atualizado em 19/10/2026, após a quarta rodada de respostas.

## Respondidas

| #   | Pergunta                                          | Resposta                                                                                                   | Onde foi aplicada                                                                                                                                  |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zitadel já instalado?                             | Não                                                                                                        | Caminho crítico dos dias 1 e 2                                                                                                                     |
| 2   | Google Workspace ou Microsoft 365?                | Google Workspace                                                                                           | IdP Google no Zitadel (02-identidade)                                                                                                              |
| 3a  | SMTP                                              | Gmail, `suporte@missaosalesiana.org.br`                                                                    | 03-arquitetura, R11                                                                                                                                |
| 3b  | Canal atual                                       | **E-mail para `suporte@` abre o ticket**; demais interações por e-mail; portal para consulta               | Abertura por e-mail no MVP (01-escopo, 03-arquitetura §3.3, ADR-010, T21)                                                                          |
| 4   | Conta Magalu ativa?                               | Sim                                                                                                        | —                                                                                                                                                  |
| 5a  | Domínio                                           | `suporte.msmt.org.br`                                                                                      | 03-arquitetura. Premissa: Zitadel em `auth.msmt.org.br`                                                                                            |
| 5b  | Quem cria registros DNS?                          | O próprio desenvolvedor                                                                                    | —                                                                                                                                                  |
| 6a  | Licença do Freshdesk                              | Vence em ~20 dias (~08/11)                                                                                 | Duas datas de go-live (05-plano §5.1)                                                                                                              |
| 6b  | Migrar o histórico?                               | Não agora                                                                                                  | Fora do plano. Só o export de segurança (R6)                                                                                                       |
| 7   | Estrutura                                         | Agentes, empresas (= unidades), departamentos; permissões básicas                                          | `companies` e `departments` no MVP                                                                                                                 |
| 8   | DPO                                               | Samuel Rees, DataGuardian                                                                                  | 04-lgpd                                                                                                                                            |
| 9   | Agentes atendem várias escolas?                   | Sim                                                                                                        | Filtro por unidade nas filas                                                                                                                       |
| 10  | Interpretação de empresa e departamento           | Confirmada. Terceiros só por e-mail, sem acesso, marcados no cadastro. Todo usuário com acesso tem unidade | `is_external`, tela de 1º acesso, triagem "sem unidade"                                                                                            |
| 12  | `suporte@` é caixa de usuário ou Grupo do Google? | **Caixa de usuário** do Gmail                                                                              | IMAP direto na caixa. Risco R10 eliminado                                                                                                          |
| 13  | Como `suporte@` chega ao Freshdesk?               | **O Freshdesk lê a caixa diretamente**; não há encaminhamento                                              | A virada vira "desconectar a caixa no admin do Freshdesk". O leitor IMAP usa só o UID e ignora a flag de lido (05-plano §5.4, 03-arquitetura §3.3) |
| 14  | Agentes respondem pelo Freshdesk ou pelo e-mail?  | Pelo Freshdesk                                                                                             | Respostas pelo portal. Resposta de agente por e-mail continua funcionando como efeito colateral, sem prioridade                                    |
| 15  | Outras caixas além de `suporte@`?                 | Não, só essa                                                                                               | Uma caixa no MVP e na Fase 2                                                                                                                       |
| 16  | `msmt.org.br` é domínio do Workspace?             | Não: é domínio de serviço, sem e-mail. O e-mail é só `missaosalesiana.org.br`                              | `INTERNAL_EMAIL_DOMAINS=missaosalesiana.org.br`                                                                                                    |
| 11  | Acesso ao Google Cloud Console e senhas de app    | Sim                                                                                                        | —                                                                                                                                                  |

## Ainda em aberto

Nenhuma pergunta bloqueante.

Única verificação pendente, sem urgência: no admin do Freshdesk (Admin → Canais → E-mail → `suporte@`), anotar **como** a caixa está conectada (Gmail via OAuth ou IMAP com senha) e onde fica o botão de desconectar. É ali que a virada de 27/10 acontece (05-plano §5.4).

## Para decidir depois (não bloqueia)

- Onde o repositório ficará hospedado (GitHub, Azure DevOps, GitLab), para o CI/CD da Fase 2.
- Precisa de app móvel? A premissa é que não: a SPA é responsiva.
- Precisa de multi-idioma? A premissa é que não: só pt-BR.
