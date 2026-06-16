/**
 * Stripe Service
 *
 * Calls the stripe-service REST API directly using S2S auth (AWS-IAM SSO
 * tokens minted via gd-auth-lib).
 *
 * Two endpoints today:
 *   - POST /v1/sandboxes    — create-or-fetch a Stripe claimable sandbox for an app
 *   - GET  /v1/status       — read current claim state for an app's sandbox
 *
 * Stripe-service runs `internal/stripe.FakeClient` today, so /v1/sandboxes
 * returns deterministic synthetic IDs (`cbsbx_fake_*` / `acct_fake_*`) without
 * a real Stripe call. When `internal/stripe.FakeClient` is swapped for the
 * real `internal/stripeapi.Client` and Stripe rejects (e.g. preview not
 * enabled), this client surfaces it as a `StripeServiceError` with
 * `code='STRIPE_CREATE_FAILED'` so the calling skill can degrade gracefully.
 */

import { getS2SToken } from '@airo/ai-lib';

import { logger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateSandboxInput {
  appId: string;
  /** GoDaddy customer ID forwarded from the agent session context. stripe-service
   *  uses this to look up the user's email from the GoDaddy PIE API for
   *  Stripe's SandboxPrefill — never echoed back or persisted. */
  customerId?: string;
  /** ISO-3166-1 alpha-2 country code collected from the user in chat.
   *  Safe caller-supplied prefill: no notification vector. */
  country: string;
}

export interface SandboxResponse {
  sandboxId: string;
  accountId: string;
  claimUrl: string;
}

export type ClaimStatus = 'provisioned' | 'claimed' | 'live' | 'revoked';

export interface StatusResponse {
  sandboxId: string;
  claimStatus: ClaimStatus;
  liveAccountId?: string;
}

/**
 * Error thrown for any non-2xx response from stripe-service (except 404 on
 * GET /v1/status, which resolves to `null`). `code` mirrors stripe-service's
 * error envelope (`{"code":"X","error":"Y"}`); callers pattern-match on it
 * — e.g. `STRIPE_CREATE_FAILED` is the post-swap "preview not enabled"
 * surface that the stripe skill maps to a "still being
 * provisioned" message.
 */
export class StripeServiceError extends Error {
  // Cap the retained response body so a misconfigured ALB returning a
  // multi-MB HTML page doesn't balloon the error instance and any traces
  // it ends up in. Real stripe-service responses are <1KB.
  static readonly MAX_RESPONSE_TEXT_LENGTH = 2048;

  public readonly responseText: string;

  constructor(
    public readonly status: number,
    public readonly code: string,
    responseText: string,
  ) {
    const truncated = responseText.length > StripeServiceError.MAX_RESPONSE_TEXT_LENGTH
      ? responseText.slice(0, StripeServiceError.MAX_RESPONSE_TEXT_LENGTH) + '…[truncated]'
      : responseText;
    super(`stripe-service ${code} (HTTP ${status}): ${truncated.slice(0, 200)}`);
    this.name = 'StripeServiceError';
    this.responseText = truncated;
  }
}

// ============================================================================
// URL Resolution
// ============================================================================

const stripeServiceUrls = {
  dev: 'https://stripe.airo-builder.dev-godaddy.com',
  test: 'https://stripe.airo-builder.test-godaddy.com',
  prod: 'https://stripe.airo-builder.godaddy.com',
} as const;

function getStripeServiceBaseUrl(): string {
  if (process.env.STRIPE_SERVICE_API_URL) return process.env.STRIPE_SERVICE_API_URL;
  return stripeServiceUrls[resolveEnv()];
}

// ============================================================================
// Service
// ============================================================================

class StripeService {
  private readonly appKey = 'airo-app-builder';

  private async buildHeaders(): Promise<Record<string, string>> {
    const token = await getS2SToken();
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'x-app-key': this.appKey,
    };
  }

  /**
   * Parse stripe-service's error envelope and throw a typed error. The
   * envelope shape is `{"code":"X","error":"Y"}` per
   * `stripe-service/internal/api/respond.go`. A misconfigured ALB or
   * unexpected proxy could return non-JSON; in that case fall back to the
   * raw response text.
   */
  private async handleErrorResponse(response: Response, operation: string, appId: string): Promise<never> {
    const responseText = await response.text();
    let code = 'UNKNOWN';
    try {
      const parsed = JSON.parse(responseText) as { code?: string };
      if (typeof parsed.code === 'string' && parsed.code.length > 0) {
        code = parsed.code;
      }
    } catch {
      // non-JSON body — leave code='UNKNOWN', the raw text lives in responseText
    }

    logger.error(`stripe_service.${operation}.api_error`, {
      appId,
      status: response.status,
      code,
      responseText: responseText.slice(0, 500),
    });

    throw new StripeServiceError(response.status, code, responseText);
  }

  /**
   * Normalize thrown errors from fetch (network, timeout, abort) so the
   * caller sees a consistent shape. StripeServiceError propagates as-is.
   * `appId` threads through every log line so a single grep on `appId=X`
   * surfaces the full lifecycle (begin → api_error / timeout / aborted /
   * error) without timestamp correlation.
   */
  private handleCatchError(error: unknown, operation: string, appId: string): never {
    if (error instanceof StripeServiceError) {
      throw error;
    }
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      logger.error(`stripe_service.${operation}.${error.name === 'TimeoutError' ? 'timeout' : 'aborted'}`, {
        appId,
      });
      throw error;
    }
    logger.error(`stripe_service.${operation}.error`, {
      appId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof Error ? error : new Error(String(error), { cause: error });
  }

  /**
   * Create or return the existing Stripe claimable sandbox for an app.
   * Idempotent on `appId` server-side: 200 returns the existing sandbox,
   * 201 returns a freshly created one. Both share the same body shape, so
   * the caller doesn't need to distinguish.
   */
  async createSandbox(input: CreateSandboxInput): Promise<SandboxResponse> {
    const url = `${getStripeServiceBaseUrl()}/v1/sandboxes`;

    logger.info('stripe_service.create_sandbox.begin', {
      appId: input.appId,
      url,
    });

    try {
      const headers = await this.buildHeaders();
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          appId: input.appId,
          ...(input.customerId && { customerId: input.customerId }),
          country: input.country,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        await this.handleErrorResponse(response, 'create_sandbox', input.appId);
      }

      const result = (await response.json()) as SandboxResponse;
      logger.info('stripe_service.create_sandbox.success', {
        appId: input.appId,
        sandboxId: result.sandboxId,
      });
      return result;
    } catch (error) {
      this.handleCatchError(error, 'create_sandbox', input.appId);
    }
  }

  /**
   * Read the current claim state for an app's sandbox. Returns `null`
   * when stripe-service has no record of a sandbox for this app (HTTP
   * 404). All other non-2xx responses throw `StripeServiceError`.
   */
  async getStatus(appId: string): Promise<StatusResponse | null> {
    const baseUrl = getStripeServiceBaseUrl();
    const url = `${baseUrl}/v1/status?appId=${encodeURIComponent(appId)}`;

    logger.info('stripe_service.get_status.begin', { appId, url });

    try {
      const headers = await this.buildHeaders();
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 404) {
        logger.info('stripe_service.get_status.not_found', { appId });
        return null;
      }
      if (!response.ok) {
        await this.handleErrorResponse(response, 'get_status', appId);
      }

      const result = (await response.json()) as StatusResponse;
      logger.info('stripe_service.get_status.success', {
        appId,
        sandboxId: result.sandboxId,
        claimStatus: result.claimStatus,
      });
      return result;
    } catch (error) {
      this.handleCatchError(error, 'get_status', appId);
    }
  }
}

export const stripeService = new StripeService();
