# Spec Txx — <título curto>

> Status: rascunho | pronta | implementada · Tarefas: Txx · Depende de: Tyy · Revisada em: dd/mm/aaaa

## 1. Objetivo

Duas ou três linhas: o que o sistema passa a fazer quando esta spec estiver implementada, e para quem.

## 2. Fora de escopo

O que alguém poderia achar que entra aqui e não entra, com a referência de onde entra.

## 3. Fatos externos que esta spec assume

| Fato | Fonte               | Confirmar?       |
| ---- | ------------------- | ---------------- |
| ...  | 📘 doc / 💡 decisão | ⚠️ como e quando |

## 4. Regras de negócio

- **RN-01** — Uma regra por item, verificável. Evite "deve ser rápido"; prefira "responde em até N".
- **RN-02** — ...

## 5. Contrato da API

Rotas, papéis, request, response e erros. Um bloco por rota.

## 6. Dados

Tabelas e colunas tocadas, migrações necessárias, índices.

## 7. Configuração

Variáveis de ambiente novas ou alteradas, com valor de dev e de produção.

## 8. Casos de borda

Lista do que dá errado e o comportamento esperado em cada caso.

## 9. Casos de teste

| CT    | Dado | Quando | Então | Cobre |
| ----- | ---- | ------ | ----- | ----- |
| CT-01 | ...  | ...    | ...   | RN-01 |

## 10. Decisões tomadas na implementação

Preenchido depois da sessão: o que mudou em relação à spec e por quê.

## 11. Prompt sugerido para a sessão

```text
Leia docs/specs/Txx-....md. Antes de escrever código, apresente um plano com: arquivos a criar ou alterar, ordem de implementação, e como cada CT vira teste. Aguarde minha aprovação.
```
