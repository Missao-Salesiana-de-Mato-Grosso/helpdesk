# Specs

Uma spec por tarefa (ou grupo de tarefas) do backlog em `docs/discovery/05-plano-mvp.md`, escrita **na véspera** da sessão do Claude Code que vai implementá-la. Só as tarefas em que a ambiguidade custa caro ganham spec; para as demais, a linha do backlog basta.

| Spec                                                       | Tarefas                            | Status       | Sessão prevista |
| ---------------------------------------------------------- | ---------------------------------- | ------------ | --------------- |
| [T04-T05-auth-jit.md](T04-T05-auth-jit.md)                 | T04, T05 (+ contrato para T06)     | implementada | ter 20/10       |
| [T08-T10-tickets-core.md](T08-T10-tickets-core.md)         | T08, T09, T10                      | implementada | qua 21/10       |
| [T14-notifications.md](T14-notifications.md)               | T14                                | implementada | qua 21/10       |
| [T21-inbound-email.md](T21-inbound-email.md)               | T21                                | implementada | qui 22/10       |
| [T17-deploy.md](T17-deploy.md)                             | T17 (e etapas 4, 5 e 8 do rollout) | implementada | dom 25/10       |
| [T22-onboarding-liberacao.md](T22-onboarding-liberacao.md) | T22 (ADR-011; depende da T15)      | rascunho     | a definir       |

## Como usar uma spec numa sessão do Claude Code

1. Abra a sessão na raiz do repositório (o `CLAUDE.md` é carregado automaticamente).
2. Cole o "prompt sugerido" que fica no fim da spec. Ele pede primeiro um **plano**, não código.
3. Revise o plano contra as regras (RN) e os casos de teste (CT) da spec. Corrija antes de autorizar.
4. Autorize a implementação. Exija que **todos os CTs virem testes automatizados** com o mesmo identificador no nome (`it('CT-07 ...')`).
5. Rode `pnpm typecheck && pnpm lint && pnpm test`. Revise o diff com atenção especial a `auth/`, `tickets/` e `inbound-email/`.
6. Commit. Atualize o status da spec para `implementada` e registre em "Decisões tomadas na implementação" o que mudou em relação ao escrito.

## Convenções

- **RN-nn** = regra de negócio. **CT-nn** = caso de teste, sempre referenciando as RNs que cobre.
- 📘 = fato documentado pelo fornecedor · 💡 = decisão nossa · ⚠️ = premissa a confirmar.
- Códigos de erro da API ficam no enum `ApiErrorCode` em `packages/shared`. Toda spec que cria um código novo o lista.
- A spec descreve **comportamento**, não implementação. Nomes de classes e arquivos são sugestões; a estrutura de pastas obrigatória está em `docs/discovery/03-arquitetura.md`.

O template está em [_template.md](_template.md).
