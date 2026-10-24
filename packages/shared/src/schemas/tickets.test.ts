import { describe, expect, it } from 'vitest';
import { createMessageSchema, createTicketSchema, listTicketsQuerySchema } from './tickets.js';

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
