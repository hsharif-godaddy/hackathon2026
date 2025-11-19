/**
 * OAuth Token Claims Extraction Utilities
 *
 * Helpers for extracting claims from OAuth access tokens (JWT format).
 * These functions decode tokens for reading claims only - no signature verification.
 */

/**
 * Extract customer ID from OAuth access token's sub claim
 *
 * OAuth access tokens from GoDaddy contain a `sub` claim in the format `customer:{customerId}`.
 * This helper decodes the token (without verification) and extracts the customer ID.
 *
 * @param accessToken - JWT access token from OAuth provider
 * @returns Customer ID extracted from the sub claim
 * @throws {Error} If token format is invalid or sub claim is missing/malformed
 *
 * @example
 * ```typescript
 * const { accessToken } = await AuthService.getAccessToken({
 *   appId: 'app-123',
 *   scopes: ['commerce.store:read']
 * });
 * const customerId = getCustomerIdFromAccessToken(accessToken);
 * // customerId: '12345678'
 * ```
 */
export function getCustomerIdFromAccessToken(accessToken: string): string {
  // Decode JWT payload (no verification - we trust tokens from AuthService)
  const parts = accessToken.split('.');

  if (parts.length < 2) {
    throw new Error('Invalid access token format: expected JWT with header.payload.signature');
  }

  let payload: { sub?: string };
  try {
    const payloadPart = parts[1];
    if (!payloadPart) {
      throw new Error('Missing payload section in JWT');
    }
    const payloadJson = Buffer.from(payloadPart, 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson) as { sub?: string };
  } catch (err) {
    throw new Error(
      `Failed to decode access token payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const sub = payload.sub || '';
  if (!sub.startsWith('customer:')) {
    throw new Error(
      `Access token missing expected sub format (customer:{id}), got: ${sub || '(empty)'}`
    );
  }

  const customerId = sub.split(':', 2)[1];
  if (!customerId) {
    throw new Error(`Failed to extract customer ID from sub claim: ${sub}`);
  }

  return customerId;
}
