// Spec docs/specs/T40-csat.md — validação das rotas públicas da avaliação.
import { describe, expect, it } from 'vitest';
import { satisfactionLookupSchema, satisfactionRateSchema } from './satisfaction.js';

const token = 'a'.repeat(43);
const rate = (body: object) => satisfactionRateSchema.safeParse({ token, ...body });

describe('satisfactionRateSchema (T40)', () => {
  it('CT-10 aceita nota de 1 a 5; apara o comentário e troca vazio por null', () => {
    expect(rate({ score: 1 }).data).toEqual({ token, score: 1, comment: null });
    expect(rate({ score: 5, comment: '  Ótimo atendimento.  ' }).data?.comment).toBe(
      'Ótimo atendimento.',
    );
    expect(rate({ score: 3, comment: '   ' }).data?.comment).toBeNull();
    expect(rate({ score: 3, comment: null }).data?.comment).toBeNull();
    expect(rate({ score: 4, comment: 'x'.repeat(1000) }).success).toBe(true);
  });

  it('CT-11 recusa nota fora de 1–5, fracionada, comentário longo e token ausente ou estranho', () => {
    expect(rate({ score: 0 }).success).toBe(false);
    expect(rate({ score: 6 }).success).toBe(false);
    expect(rate({ score: 3.5 }).success).toBe(false);
    expect(rate({ score: '4' }).success).toBe(false);
    expect(rate({ score: 4, comment: 'x'.repeat(1001) }).success).toBe(false);
    expect(rate({ score: 4, extra: true }).success).toBe(false);
    expect(satisfactionRateSchema.safeParse({ score: 4 }).success).toBe(false);
    expect(satisfactionLookupSchema.safeParse({ token: '' }).success).toBe(false);
    expect(satisfactionLookupSchema.safeParse({ token: 'abc/def' }).success).toBe(false);
    expect(satisfactionLookupSchema.safeParse({ token }).success).toBe(true);
  });
});
