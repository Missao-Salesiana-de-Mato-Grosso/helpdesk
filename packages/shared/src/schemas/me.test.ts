import { describe, expect, it } from 'vitest';
import { updateMeSchema } from './me.js';

const valid = {
  companyId: '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d',
  departmentId: '6a1e0c3b-2f4d-4b8a-8e2c-9d7f6e5a4b3c',
};

describe('updateMeSchema', () => {
  it('accepts companyId and departmentId', () => {
    expect(updateMeSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing field', () => {
    expect(updateMeSchema.safeParse({ companyId: valid.companyId }).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(updateMeSchema.safeParse({ ...valid, name: 'x' }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    expect(updateMeSchema.safeParse({ ...valid, companyId: '1' }).success).toBe(false);
  });
});
