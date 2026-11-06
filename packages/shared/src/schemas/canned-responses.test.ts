import { describe, expect, it } from 'vitest';
import {
  createCannedResponseSchema,
  fillCannedResponse,
  firstName,
  updateCannedResponseSchema,
} from './canned-responses.js';

const values = { solicitante: 'Maria', numero: '#1042', agente: 'João' };

describe('fillCannedResponse', () => {
  it('replaces the known variables, with or without spaces inside the braces', () => {
    expect(fillCannedResponse('<p>Olá, {{solicitante}}! Chamado {{ numero }}.</p>', values)).toBe(
      '<p>Olá, Maria! Chamado #1042.</p>',
    );
  });

  it('keeps unknown variables untouched', () => {
    expect(fillCannedResponse('<p>{{setor}} / {{agente}}</p>', values)).toBe(
      '<p>{{setor}} / João</p>',
    );
  });

  it('escapes the values as text', () => {
    expect(
      fillCannedResponse('<p>{{solicitante}}</p>', { ...values, solicitante: '<b>Ana</b> & Cia' }),
    ).toBe('<p>&lt;b&gt;Ana&lt;/b&gt; &amp; Cia</p>');
  });
});

describe('firstName', () => {
  it('takes the first word and handles empty names', () => {
    expect(firstName('  Maria  da Silva ')).toBe('Maria');
    expect(firstName('')).toBe('');
  });
});

describe('canned response schemas', () => {
  it('trims the title and requires the text', () => {
    expect(createCannedResponseSchema.parse({ title: ' Senha ', bodyHtml: '<p>x</p>' })).toEqual({
      title: 'Senha',
      bodyHtml: '<p>x</p>',
    });
    expect(createCannedResponseSchema.safeParse({ title: 'Senha', bodyHtml: '' }).success).toBe(
      false,
    );
  });

  it('rejects an empty update', () => {
    expect(updateCannedResponseSchema.safeParse({}).success).toBe(false);
    expect(updateCannedResponseSchema.safeParse({ title: 'Outro' }).success).toBe(true);
  });
});
