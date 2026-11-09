// T29: importa os chamados abertos do Freshdesk. Roda num pod do cluster (o banco só é alcançável
// pela rede privada), com a imagem e o ambiente da API. Passo a passo em docs/runbook.md §16.
//
//   node dist/import/freshdesk-import.js <pasta-do-pacote>            # simula (não grava nada)
//   node dist/import/freshdesk-import.js <pasta-do-pacote> --apply    # grava
//
// Opções:
//   --keep 18277,18279             importa mesmo com possível duplicado
//   --map-group "Nome lá=Nome aqui"   grupo do Freshdesk → grupo daqui (repetível)
//   --map-mailbox "caixa@...=Grupo"   chamado sem grupo, pela caixa de destino (repetível)
//
// A saída tem só ids, contagens e nomes de grupo.

// Script de linha de comando: o console é a saída.
// oxlint-disable no-console
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_GROUP_RULES, type GroupRules } from './freshdesk-bundle.js';
import { FreshdeskImportModule } from './freshdesk-import.module.js';
import {
  FreshdeskImportService,
  type ImportReport,
  type TicketAction,
} from './freshdesk-import.service.js';

const ACTION_LABEL: Record<TicketAction, string> = {
  import: 'a importar',
  imported: 'importado',
  'skip-duplicate': 'pulado: possível duplicado',
  'skip-existing': 'pulado: já importado',
  failed: 'FALHOU',
};

function pairs(
  values: string[] | undefined,
  base: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map(base);
  for (const value of values ?? []) {
    const [from, to] = value.split('=').map((part) => part.trim());
    if (!from || !to) throw new Error(`Use "origem=destino" (recebido: ${value})`);
    result.set(from.toLowerCase().includes('@') ? from.toLowerCase() : from, to);
  }
  return result;
}

function print(report: ImportReport): void {
  for (const plan of report.tickets) {
    const target = plan.number === null ? '' : ` → #${plan.number}`;
    const duplicate =
      plan.duplicateOf.length > 0
        ? ` (parece: ${plan.duplicateOf.map((n) => `#${n}`).join(', ')})`
        : '';
    console.log(
      `Freshdesk #${plan.freshdeskId}${target} · ${plan.status === 'open' ? 'aberto' : 'pendente'} · ` +
        `${plan.group} · ${plan.messages} msg · ${plan.attachments} anexos + ${plan.inlineImages} imagens · ` +
        `${ACTION_LABEL[plan.action]}${duplicate}${plan.error ? ` (${plan.error})` : ''}`,
    );
  }
  const count = (action: TicketAction) =>
    report.tickets.filter((plan) => plan.action === action).length;
  console.log('');
  console.log(
    report.applied
      ? `Importados: ${count('imported')} · falharam: ${count('failed')} · anexos recusados: ${report.rejectedAttachments}`
      : `SIMULAÇÃO (nada gravado). A importar: ${count('import')} · contatos novos: ${report.newContacts}`,
  );
  console.log(
    `Pulados: ${count('skip-duplicate')} possível duplicado (use --keep para importar), ` +
      `${count('skip-existing')} já importados.`,
  );
  if (report.missingGroups.length > 0) {
    console.log(
      `Grupos que não existem aqui (crie em Administração → Grupos ou use --map-group): ` +
        `${report.missingGroups.join(', ')}. Nada foi gravado.`,
    );
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      apply: { type: 'boolean', default: false },
      keep: { type: 'string' },
      'map-group': { type: 'string', multiple: true },
      'map-mailbox': { type: 'string', multiple: true },
    },
  });
  const dir = positionals[0];
  if (!dir) throw new Error('Informe a pasta do pacote (a que tem o bundle.json).');
  const keep = new Set(
    (values.keep ?? '')
      .split(',')
      .map((id) => Number(id.trim().replace(/^#/, '')))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  const rules: GroupRules = {
    groups: pairs(values['map-group'], DEFAULT_GROUP_RULES.groups),
    mailboxes: pairs(values['map-mailbox'], DEFAULT_GROUP_RULES.mailboxes),
  };

  const app = await NestFactory.createApplicationContext(FreshdeskImportModule, {
    logger: ['error', 'warn'],
  });
  try {
    print(await app.get(FreshdeskImportService).run({ dir, apply: values.apply, keep, rules }));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Falhou: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
