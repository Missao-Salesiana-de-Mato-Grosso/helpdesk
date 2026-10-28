import { describe, expect, it } from 'vitest';
import {
  approveAccessSchema,
  listAccessRequestsQuerySchema,
  rejectAccessSchema,
} from './access-requests.js';

const ids = {
  companyId: '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d',
  departmentId: '6a1e0c3b-2f4d-4b8a-8e2c-9d7f6e5a4b3c',
};

describe('approveAccessSchema', () => {
  it('accepts companyId and departmentId', () => {
    expect(approveAccessSchema.safeParse(ids).success).toBe(true);
  });

  it('accepts an optional isExternal', () => {
    expect(approveAccessSchema.safeParse({ ...ids, isExternal: true }).success).toBe(true);
  });

  it('rejects a missing department', () => {
    expect(approveAccessSchema.safeParse({ companyId: ids.companyId }).success).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(approveAccessSchema.safeParse({ ...ids, note: 'x' }).success).toBe(false);
  });
});

describe('rejectAccessSchema', () => {
  it('accepts no body', () => {
    expect(rejectAccessSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a note up to 500 characters', () => {
    expect(rejectAccessSchema.safeParse({ note: 'x'.repeat(500) }).success).toBe(true);
  });

  it('rejects a note over 500 characters', () => {
    expect(rejectAccessSchema.safeParse({ note: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('listAccessRequestsQuerySchema', () => {
  it('defaults to status=pending, page=1, pageSize=25', () => {
    const result = listAccessRequestsQuerySchema.parse({});
    expect(result).toEqual({ status: 'pending', page: 1, pageSize: 25 });
  });

  it('accepts status=trashed', () => {
    expect(listAccessRequestsQuerySchema.safeParse({ status: 'trashed' }).success).toBe(true);
  });

  it('rejects an invalid status', () => {
    expect(listAccessRequestsQuerySchema.safeParse({ status: 'approved' }).success).toBe(false);
  });
});
