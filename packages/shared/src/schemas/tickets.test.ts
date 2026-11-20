import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_TICKETS,
  bulkUpdateTicketsSchema,
  createMessageSchema,
  createTicketSchema,
  listTicketsQuerySchema,
} from './tickets.js';

const uuid = '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d';

describe('createTicketSchema', () => {
  it('aplica trim no assunto e prioridade padrão medium', () => {
    const parsed = createTicketSchema.parse({
      subject: '  Impressora  ',
      bodyHtml: '<p>x</p>',
      categoryId: uuid,
    });
    expect(parsed.subject).toBe('Impressora');
    expect(parsed.priority).toBe('medium');
  });

  it('recusa assunto com 201 caracteres e campos extras', () => {
    expect(
      createTicketSchema.safeParse({ subject: 'a'.repeat(201), bodyHtml: 'x', categoryId: uuid })
        .success,
    ).toBe(false);
    expect(
      createTicketSchema.safeParse({ subject: 'abc', bodyHtml: 'x', categoryId: uuid, foo: 1 })
        .success,
    ).toBe(false);
  });

  it('recusa corpo acima de 100 KB', () => {
    expect(
      createTicketSchema.safeParse({
        subject: 'abc',
        bodyHtml: 'x'.repeat(100 * 1024 + 1),
        categoryId: uuid,
      }).success,
    ).toBe(false);
  });
});

describe('listTicketsQuerySchema', () => {
  it('aceita um ou vários status e converte números e booleanos da query string', () => {
    expect(listTicketsQuerySchema.parse({ status: 'open' }).status).toEqual(['open']);
    const parsed = listTicketsQuerySchema.parse({
      status: ['open', 'pending'],
      page: '2',
      pageSize: '10',
      noCompany: 'true',
    });
    expect(parsed).toMatchObject({
      status: ['open', 'pending'],
      page: 2,
      pageSize: 10,
      noCompany: true,
    });
  });

  it('usa os padrões de paginação e ordenação', () => {
    expect(listTicketsQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: 'updated_at:desc',
    });
  });

  it('recusa pageSize acima de 100', () => {
    expect(listTicketsQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
  });
});

describe('createMessageSchema', () => {
  it('exige version quando vem status', () => {
    expect(
      createMessageSchema.safeParse({ kind: 'public', bodyHtml: 'x', status: 'pending' }).success,
    ).toBe(false);
    expect(
      createMessageSchema.safeParse({
        kind: 'public',
        bodyHtml: 'x',
        status: 'pending',
        version: 1,
      }).success,
    ).toBe(true);
  });
});

const message = (inlineImages: unknown) =>
  createMessageSchema.safeParse({ kind: 'public', bodyHtml: '<p>x</p>', inlineImages });

describe('inlineImages (spec T32)', () => {
  it('CT-19 aceita até 10 chaves válidas, na mensagem e na abertura do chamado', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `img-${i}_A`);
    expect(message(keys).success).toBe(true);
    expect(
      createTicketSchema.safeParse({
        subject: 'abc',
        bodyHtml: 'x',
        categoryId: uuid,
        inlineImages: ['a1'],
      }).success,
    ).toBe(true);
  });

  it('CT-19 recusa 11 chaves, chave repetida e chave com caracteres inválidos', () => {
    expect(message(Array.from({ length: 11 }, (_, i) => `k${i}`)).success).toBe(false);
    expect(message(['a', 'a']).success).toBe(false);
    expect(message(['a b']).success).toBe(false);
    expect(message(['"><script>']).success).toBe(false);
    expect(message(['']).success).toBe(false);
    expect(message(['x'.repeat(65)]).success).toBe(false);
  });
});

const valid = (body: unknown) => bulkUpdateTicketsSchema.safeParse(body).success;
const ticket = (n: number) => ({
  id: `0b6f2a52-6f0e-4d7e-9a43-${n.toString().padStart(12, '0')}`,
  version: 1,
});
const many = (count: number) => Array.from({ length: count }, (_, n) => ticket(n));

describe('bulkUpdateTicketsSchema (spec T35)', () => {
  it('CT-19 aceita 1 e 100 chamados, recusa 0, 101 e repetidos', () => {
    const changes = { priority: 'high' };
    expect(valid({ tickets: many(1), changes })).toBe(true);
    expect(valid({ tickets: many(MAX_BULK_TICKETS), changes })).toBe(true);
    expect(valid({ tickets: [], changes })).toBe(false);
    expect(valid({ tickets: many(MAX_BULK_TICKETS + 1), changes })).toBe(false);
    expect(valid({ tickets: [ticket(1), ticket(1)], changes })).toBe(false);
    expect(valid({ tickets: [{ id: 'abc', version: 1 }], changes })).toBe(false);
  });

  it('CT-19 exige exatamente um campo e aceita assigneeId null', () => {
    const tickets = many(2);
    expect(valid({ tickets, changes: { assigneeId: null } })).toBe(true);
    expect(valid({ tickets, changes: { companyId: uuid } })).toBe(true);
    expect(valid({ tickets, changes: {} })).toBe(false);
    expect(valid({ tickets, changes: { priority: 'high', status: 'closed' } })).toBe(false);
    expect(valid({ tickets, changes: { groupId: uuid, assigneeId: uuid } })).toBe(false);
    expect(valid({ tickets, changes: { companyId: uuid, applyCompanyToRequester: true } })).toBe(
      false,
    );
    expect(valid({ tickets, changes: { subject: 'x' } })).toBe(false);
    expect(valid({ tickets, changes: { priority: 'high' }, extra: 1 })).toBe(false);
  });
});
