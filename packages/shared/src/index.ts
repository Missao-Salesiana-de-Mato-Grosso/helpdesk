export const APP_NAME = 'Help Desk MSMT';

export { ApiErrorCode, type ApiError } from './api-error.js';
export {
  ACCESS_STATUSES,
  ROLES,
  updateMeSchema,
  type AccessStatus,
  type MeResponse,
  type NamedRef,
  type Role,
  type UpdateMeInput,
} from './schemas/me.js';
export * from './schemas/access-requests.js';
export * from './schemas/tickets.js';
export * from './schemas/users.js';
export * from './attachments.js';
