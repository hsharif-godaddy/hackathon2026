/**
 * Typed `code` values on agents HTTP error responses. Shared between app/ and agents/.
 */

export const ApiErrorCode = {
  /** requirePermission middleware 403 when JWT lacks canPublish or canDownload. */
  PermissionDenied: 'PERMISSION_DENIED',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
