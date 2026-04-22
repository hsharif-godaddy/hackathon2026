import { AuthService, AuthRequiredError } from '../../../services/auth-service.js';
import { TokenStore } from '../../../services/token-store.js';
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

function toNeedsAuthResult(error: AuthRequiredError): CommerceAuthResult<never> {
  return {
    needsAuth: true,
    redirectUrl: error.redirectUrl,
    state: error.state,
    scopes: error.scopes,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCommerceAuthorizationError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();

  return (
    message.includes('graphql request failed: unauthorized') ||
    /graphql request failed:\s*401\b.*unauthorized/.test(message) ||
    message.includes('failed to authorize') ||
    message.includes('authorization failed') ||
    message.includes('commerce onboarding api error (401)')
  );
}

async function executeWithCommerceToken<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
  forceRefresh: boolean = false,
): Promise<T> {
  const { accessToken, sub } = await AuthService.getAccessToken({ appId, forceRefresh });
  if (!sub) {
    throw new Error('Access token missing sub claim — please re-authenticate.');
  }

  return fn(accessToken, extractCustomerId(sub));
}

async function retryAfterTokenReset<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
): Promise<CommerceAuthResult<T>> {
  try {
    const data = await executeWithCommerceToken(appId, fn, true);
    logger.info('commerce.skill.auth.downstream_unauthorized.recovered_after_token_reset', { appId });
    return { success: true, data };
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      logger.info('commerce.skill.auth.required', { appId, scopes: error.scopes });
      return toNeedsAuthResult(error);
    }

    const message = getErrorMessage(error);
    logger.error('commerce.skill.auth.error', { appId, error: message });
    return { success: false, error: message };
  }
}

/**
 * Shared auth wrapper for all commerce skill tools.
 * Handles token retrieval and AuthRequiredError -> needAuth conversion.
 *
 * IMPORTANT: This wrapper catches ALL errors and returns them as
 * { success: false, error } instead of re-throwing. Commerce tools
 * are executed inside the agent-factory's tool wrapper, whose catch
 * block serialises `context.metadata` via the logger. That metadata
 * contains non-serializable objects (state machines, sockets, etc.)
 * which cause "Maximum call stack size exceeded" during JSON.stringify.
 * By never throwing, we bypass that code path entirely.
 */
export async function withCommerceAuth<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
): Promise<CommerceAuthResult<T>> {
  try {
    const data = await executeWithCommerceToken(appId, fn);
    return { success: true, data };
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      logger.info('commerce.skill.auth.required', { appId, scopes: error.scopes });
      return toNeedsAuthResult(error);
    }

    if (!isCommerceAuthorizationError(error)) {
      const message = getErrorMessage(error);
      logger.error('commerce.skill.auth.error', { appId, error: message });
      return { success: false, error: message };
    }

    logger.warn('commerce.skill.auth.downstream_unauthorized', {
      appId,
      error: getErrorMessage(error),
    });
  }

  try {
    const data = await executeWithCommerceToken(appId, fn, true);
    logger.info('commerce.skill.auth.downstream_unauthorized.recovered', { appId });
    return { success: true, data };
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      logger.info('commerce.skill.auth.required', { appId, scopes: error.scopes });
      return toNeedsAuthResult(error);
    }

    if (!isCommerceAuthorizationError(error)) {
      const message = getErrorMessage(error);
      logger.error('commerce.skill.auth.error', { appId, error: message });
      return { success: false, error: message };
    }

    TokenStore.delete({ appId, provider: 'godaddy' });
    return await retryAfterTokenReset(appId, fn);
  }
}
