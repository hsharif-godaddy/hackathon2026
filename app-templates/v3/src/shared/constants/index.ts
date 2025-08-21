export const APP_NAME = 'V3 App Template';
export const API_BASE_URL = '/api';

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const QUERY_KEYS = {
  HEALTH: 'health',
} as const;
