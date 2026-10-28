import { describe, expect, it } from 'vitest';
import { listUsersQuerySchema, replaceGroupMembersSchema, updateUserSchema } from './users.js';

const id = '0b6f2a52-6f0e-4d7e-9a43-3c1d1a2b3c4d';

describe('listUsersQuerySchema', () => {
  it('applies the pagination defaults and trims q', () => {
    expect(listUsersQuerySchema.parse({ q: '  maria ' })).toEqual({
      q: 'maria',
      page: 1,
      pageSize: 25,
    });
  });

  it('accepts role=agent only', () => {
    expect(listUsersQuerySchema.safeParse({ role: 'agent' }).success).toBe(true);
    expect(listUsersQuerySchema.safeParse({ role: 'admin' }).success).toBe(false);
  });

  it('rejects unknown parameters', () => {
    expect(listUsersQuerySchema.safeParse({ status: 'trashed' }).success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('accepts any subset of the editable fields', () => {
    expect(updateUserSchema.safeParse({ active: false }).success).toBe(true);
    expect(
      updateUserSchema.safeParse({ companyId: id, departmentId: id, isExternal: true }).success,
    ).toBe(true);
  });

  it('rejects an empty body', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it('rejects fields that are not editable here (roles come from Zitadel)', () => {
    expect(updateUserSchema.safeParse({ roles: ['admin'] }).success).toBe(false);
    expect(updateUserSchema.safeParse({ email: 'x@y.z' }).success).toBe(false);
  });
});

describe('replaceGroupMembersSchema', () => {
  it('accepts an empty list (group without members)', () => {
    expect(replaceGroupMembersSchema.safeParse({ userIds: [] }).success).toBe(true);
  });

  it('rejects ids that are not uuids', () => {
    expect(replaceGroupMembersSchema.safeParse({ userIds: ['1'] }).success).toBe(false);
  });
});
