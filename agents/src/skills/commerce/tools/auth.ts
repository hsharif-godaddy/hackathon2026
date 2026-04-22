import { AuthService, AuthRequiredError } from '../../../services/auth-service.js';
import { Logger } from '../../../logging/index.js';

const logger = Logger.create({ component: 'commerce.skill' });

/**
 * Extract customerId from the JWT `sub` claim.
 * The `sub` claim is in the format `customer:{customerId}`.
 */
function extractCustomerId(sub: string): string {
  if (!sub.startsWith('customer:')) {
    throw new Error(`Access token missing expected sub format (customer:{id}), got: ${sub || '(empty)'}`);
  }
  const customerId = sub.split(':', 2)[1];
  if (!customerId) {
    throw new Error(`Failed to extract customer ID from sub claim: ${sub}`);
  }
  return customerId;
}

export type CommerceAuthResult<T> =
  | { success: true; data: T; needsAuth?: never; error?: never }
  | { needsAuth: true; redirectUrl: string; state: string; scopes: string[]; success?: never; data?: never; error?: never }
  | { success: false; error: string; needsAuth?: never; data?: never };

/**
 * Shared auth wrapper for all commerce skill tools.
 * Handles token retrieval and AuthRequiredError -> needAuth conversion.
 *
 * IMPORTANT: This wrapper catches ALL errors and returns them as
 * { success: false, error } instead of re-throwing.  Commerce tools
 * are executed inside the agent-factory's tool wrapper, whose catch
 * block serialises `context.metadata` via the logger.  That metadata
 * contains non-serializable objects (state machines, sockets, etc.)
 * which cause "Maximum call stack size exceeded" during JSON.stringify.
 * By never throwing, we bypass that code path entirely.
 */
export async function withCommerceAuth<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
): Promise<CommerceAuthResult<T>> {
  try {
    const { accessToken, sub } = await AuthService.getAccessToken({ appId });
    if (!sub) {
      return { success: false, error: 'Access token missing sub claim — please re-authenticate.' };
    }
    const customerId = extractCustomerId(sub);
    const data = await fn(accessToken, customerId);
    return { success: true, data };
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      logger.info('commerce.skill.auth.required', { appId, scopes: err.scopes });
      return { needsAuth: true, redirectUrl: err.redirectUrl, state: err.state, scopes: err.scopes };
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error('commerce.skill.auth.error', { appId, error: message });
    return { success: false, error: message };
  }
}
