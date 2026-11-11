import { describe, expect, it } from 'vitest';
import {
  createCategorySchema,
  createCatalogItemSchema,
  createGroupSchema,
  updateCatalogItemSchema,
  updateGroupSchema,
} from './catalog.js';

const id = '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d';

describe('createCatalogItemSchema', () => {
  it('trims the name and rejects an empty one', () => {
    expect(createCatalogItemSchema.parse({ name: '  Escola A ' })).toEqual({ name: 'Escola A' });
    expect(createCatalogItemSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createCatalogItemSchema.safeParse({ name: 'A', active: false }).success).toBe(false);
  });
});

describe('updateCatalogItemSchema', () => {
  it('accepts name, active or both, and rejects an empty body', () => {
    expect(updateCatalogItemSchema.safeParse({ active: false }).success).toBe(true);
    expect(updateCatalogItemSchema.safeParse({ name: 'B', active: true }).success).toBe(true);
    expect(updateCatalogItemSchema.safeParse({}).success).toBe(false);
  });
});

describe('group schemas', () => {
  it('turns an empty e-mail into null and validates the format', () => {
    expect(createGroupSchema.parse({ name: 'TI', email: '' })).toEqual({ name: 'TI', email: null });
    expect(updateGroupSchema.parse({ email: null })).toEqual({ email: null });
    expect(createGroupSchema.safeParse({ name: 'TI', email: 'x' }).success).toBe(false);
    expect(updateGroupSchema.parse({ inboundEmail: '' })).toEqual({ inboundEmail: null });
    expect(createGroupSchema.safeParse({ name: 'TI', inboundEmail: 'x' }).success).toBe(false);
  });
});

describe('createCategorySchema', () => {
  it('requires the default group', () => {
    expect(createCategorySchema.safeParse({ name: 'Rede', defaultGroupId: id }).success).toBe(true);
    expect(createCategorySchema.safeParse({ name: 'Rede' }).success).toBe(false);
  });
});
