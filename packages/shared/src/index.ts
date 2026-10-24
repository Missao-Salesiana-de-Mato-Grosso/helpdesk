export const APP_NAME = 'Help Desk MSMT';

export { ApiErrorCode, type ApiError } from './api-error.js';
export {
  ROLES,
  updateMeSchema,
  type MeResponse,
  type NamedRef,
  type Role,
  type UpdateMeInput,
} from './schemas/me.js';
export * from './schemas/tickets.js';
