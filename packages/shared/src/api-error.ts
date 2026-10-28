/**
 * Códigos de erro devolvidos pela API no campo `code`.
 * Cada spec em docs/specs/ lista os códigos que introduz.
 */
export const ApiErrorCode = {
  // genéricos
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',

  // autenticação e autorização (spec T04–T05)
  AUTH_MISSING: 'AUTH_MISSING',
  AUTH_INVALID: 'AUTH_INVALID',
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  WRONG_ORGANIZATION: 'WRONG_ORGANIZATION',
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  USER_INACTIVE: 'USER_INACTIVE',
  EXTERNAL_USER_CANNOT_LOGIN: 'EXTERNAL_USER_CANNOT_LOGIN',
  ONBOARDING_REQUIRED: 'ONBOARDING_REQUIRED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',

  // liberação de acesso (spec T22)
  ACCESS_PENDING: 'ACCESS_PENDING',
  ACCESS_REJECTED: 'ACCESS_REJECTED',
  ACCESS_ALREADY_DECIDED: 'ACCESS_ALREADY_DECIDED',
  ACCESS_HAS_TICKET: 'ACCESS_HAS_TICKET',

  // tickets (spec T08–T10)
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  TICKET_CLOSED: 'TICKET_CLOSED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  COMPANY_REQUIRED: 'COMPANY_REQUIRED',
  ASSIGNEE_NOT_IN_GROUP: 'ASSIGNEE_NOT_IN_GROUP',
  INACTIVE_REFERENCE: 'INACTIVE_REFERENCE',
  EMPTY_BODY: 'EMPTY_BODY',

  // anexos (T13)
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  TOO_MANY_FILES: 'TOO_MANY_FILES',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/** Formato de toda resposta de erro da API. */
export interface ApiError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  /** Só em `409 VERSION_CONFLICT`: a versão atual do ticket. */
  currentVersion?: number;
}
