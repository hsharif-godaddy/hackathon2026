// Thin constants file with no server-side imports so validators and tests
// can import these without pulling in the logger/auth/request-context chain.

/**
 * Defense-in-depth cap on the customer-supplied description / comment text
 * sent to CRM as the case body. Used by both `case-client.ts` (truncation
 * at write time) and `fanout-validation.ts` (request-time validation).
 */
export const MAX_DESCRIPTION_CHARS = 4000;
