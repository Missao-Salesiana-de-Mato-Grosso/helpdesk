# 4. LGPD

> Este capítulo é orientação técnica, não parecer jurídico. **Valide com o Encarregado (DPO) da Missão: Samuel Rees, da DataGuardian.** Sugestão: enviar este documento a ele na terça (20/10) e pedir retorno até sexta, antes do go-live.

## 4.1 Dados pessoais tratados

| Dado                                                                               | Titular                                   | Origem                           | Finalidade                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------ |
| Nome, e-mail, identificador do Zitadel                                             | Colaboradores                             | Zitadel (JIT)                    | Identificação e comunicação no atendimento |
| Empresa (escola/obra) e departamento                                               | Colaboradores                             | Informado no 1º acesso           | Roteamento, filtros e relatórios           |
| Conteúdo dos tickets e anexos                                                      | Colaboradores e **terceiros mencionados** | Digitado ou enviado pelo usuário | Prestação do suporte                       |
| Nome e e-mail de terceiros (externos)                                              | Terceiros                                 | E-mail recebido                  | Atendimento do chamado aberto por eles     |
| E-mails recebidos (cabeçalhos, corpo, anexos, `.eml` bruto)                        | Colaboradores e terceiros                 | Caixa `suporte@`                 | Prestação do suporte e rastreabilidade     |
| IP e timestamps de ações                                                           | Colaboradores                             | Gerado pelo sistema              | Segurança e auditoria (art. 46)            |
| Pedido de acesso ao portal (nome, e-mail, unidade/departamento sugeridos, decisão) | Colaboradores e terceiros                 | Informado no 1º acesso (T22)     | Avaliar e liberar o acesso ao portal       |

⚠️ **Ponto de atenção específico da Missão:** as obras salesianas atendem crianças e adolescentes (escolas e projetos sociais). Tickets de suporte (ex.: "erro ao lançar a nota do aluno X", com print) podem conter **dados de menores** (art. 14) e eventualmente **dados sensíveis** (saúde, religião – art. 5º, II). O help desk não tem essa finalidade, mas vai recebê-los por acidente. Mitigações:

1. Aviso visível no formulário de abertura: _"Não inclua dados pessoais de alunos, atendidos ou informações de saúde, a menos que sejam indispensáveis para resolver o problema."_
2. Controle de acesso estrito, em que o solicitante só vê os próprios tickets (já previsto).
3. Anonimização sob demanda (Fase 2, ver 4.3).

## 4.2 Base legal e retenção

- **Base legal sugerida:** **legítimo interesse** (art. 7º, IX) para o suporte interno à operação da instituição. Alternativamente, **execução de contrato** (art. 7º, V) no contexto da relação de trabalho. Registre a escolha no inventário de dados (ROPA) da Missão.
- **Retenção:** conforme definido, **segue o padrão da lei**. A LGPD não fixa prazo: os dados são mantidos enquanto necessários à finalidade, e o tratamento termina quando ela é alcançada (arts. 15 e 16). A conservação é permitida para cumprimento de obrigação legal e para exercício de direitos.
  - **Implementação no MVP:** nenhuma exclusão automática. Registre no ROPA que o histórico de tickets é mantido como base de conhecimento operacional e auditoria.
  - **Fase 2:** se o DPO definir um prazo, um job de anonimização de tickets fechados há mais de N anos.
- **Pedido de acesso ao portal (T22, RN-19 a RN-20):** pedido `pending` sem decisão há 30 dias vai para a lixeira por um cron (soft-delete: só marca `trashed_at`, nada é apagado). **A lixeira não tem prazo automático** — nada sai dela sozinho. A exclusão definitiva é sempre manual, só pelo papel `admin` (um item ou a lixeira inteira), e **atende o pedido de exclusão do titular** (art. 18) para quem nunca chegou a ser aprovado. Pula quem, entretanto, ganhou ticket pelo canal de e-mail (mantém o histórico de atendimento). ⚠️ **Esta regra ainda não foi validada pelo DPO** — ver a nota no topo deste documento.
- **Operadores e suboperadores:** a Magalu Cloud (infraestrutura, dados em repouso no Brasil) e o Google (login federado e envio das notificações pelo Gmail). As notificações contêm trechos dos tickets e transitam pela infraestrutura do Google, que já é o provedor de e-mail da Missão, então a transferência internacional (art. 33) tende a já estar coberta pelo enquadramento atual do Workspace. Confirme com o DPO. Como o e-mail é o canal principal, o corpo das respostas **vai** no e-mail, e o `.eml` bruto de cada mensagem recebida fica no Object Storage pelo mesmo tempo que o ticket. Oriente os agentes a não colocar dados sensíveis nas respostas quando não for indispensável.

## 4.3 Direitos do titular (art. 18)

| Direito                           | Como atender                                                                                                                                                                                                          | Quando                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Confirmação e acesso              | O próprio portal mostra os tickets do solicitante. Um export JSON por usuário fica no admin                                                                                                                           | Portal: MVP · Export: Fase 2 |
| Correção                          | Nome e e-mail no Zitadel (sincroniza no login), setor no perfil                                                                                                                                                       | MVP                          |
| Anonimização ou eliminação        | Ação de admin: substitui nome e e-mail por `Titular anonimizado #<id>`, remove anexos e os `.eml` brutos, e redige trechos do corpo quando necessário. **Mantém** o ticket e os eventos para integridade da auditoria | Fase 2                       |
| Informação sobre compartilhamento | Documental (ROPA)                                                                                                                                                                                                     | —                            |

## 4.4 Segurança (art. 46) — requisitos técnicos

**MVP:**

- [ ] TLS em todos os endpoints (cert-manager)
- [ ] Autenticação centralizada no Zitadel, com MFA para agentes, supervisores e admins
- [ ] Autorização no backend em toda consulta (testes de IDOR obrigatórios)
- [ ] `ticket_events` append-only, com ator, IP e timestamp
- [ ] Logs **sem** corpo de mensagem, conteúdo de anexo ou tokens
- [ ] Bucket de anexos **privado**, com acesso só por URL pré-assinada de curta duração
- [ ] Segredos em Kubernetes Secrets, nunca no repositório
- [ ] Backups do banco com acesso restrito e criptografados em repouso (DBaaS)
- [ ] HTML sanitizado e CSP restritiva

**Fase 2:**

- [ ] Log de **visualização** de tickets (quem abriu o quê), para tickets com dados sensíveis
- [ ] Tela de trilha de auditoria para o DPO
- [ ] Revisão periódica de quem tem roles no Zitadel

## 4.5 Incidentes (art. 48)

Registre no runbook quem é acionado (DPO e TI) e como revogar acessos com rapidez:

1. Desativar o usuário no Zitadel.
2. Marcar `active=false` no help desk (corte imediato).
3. Rotacionar as chaves de assinatura no Zitadel, se houver suspeita de vazamento de token.
