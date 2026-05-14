import { z } from 'zod';
import { sleep } from '../util/sleep.js';

export interface ProvisionResult {
  appId: string;
  previewUrl: string;
}

export interface AABCtrlPlaneClientConfig {
  baseUrl: string;
  provisionTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
}

interface SignupResponse {
  statusJobId: string;
}

const PollResponseSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  apps: z.array(z.object({
    id: z.string(),
    urls: z.object({ preview: z.string(), agent: z.string() }),
  })),
  error: z.string().optional(),
});

type PollResponse = z.infer<typeof PollResponseSchema>;

const DEFAULT_PROVISION_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const LOCAL_SUB = 'local-sub-001';
const LOCAL_SYS = 'local-sys-001';

class NonRetryableProvisionError extends Error {
  readonly statusCode?: number;
  readonly jobId?: string;

  constructor(
    message: string,
    opts?: { statusCode?: number; jobId?: string },
  ) {
    super(message);
    this.name = 'NonRetryableProvisionError';
    this.statusCode = opts?.statusCode;
    this.jobId = opts?.jobId;
  }
}

/**
 * HTTP client for the AAB local-control-plane API.
 * Provisions and tears down real app workspaces (filesystem,
 * Docker containers, preview URL) for eval scenarios.
 */
export class AABCtrlPlaneClient {
  private readonly baseUrl: string;
  private readonly provisionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(config: AABCtrlPlaneClientConfig) {
    this.baseUrl = config.baseUrl;
    this.provisionTimeoutMs =
      config.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS;
    this.pollIntervalMs =
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retryDelayMs =
      config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetries =
      config.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async provisionApp(
    options?: Record<string, unknown>,
  ): Promise<ProvisionResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const { statusJobId } = await this.signup(options ?? {});
        return await this.pollUntilComplete(statusJobId);
      } catch (err) {
        if (err instanceof NonRetryableProvisionError) throw err;
        lastErr = err;
        if (attempt < this.maxRetries) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[AABCtrlPlaneClient] provisionApp attempt ${attempt + 1} failed, ` +
            `retrying in ${this.retryDelayMs}ms: ${msg}`,
          );
          await sleep(this.retryDelayMs);
        }
      }
    }
    throw lastErr;
  }

  async deleteApp(appId: string): Promise<void> {
    const url =
      `${this.baseUrl}/api/airo/v1/subscriptions` +
      `/${LOCAL_SUB}/systems/${LOCAL_SYS}/apps/${appId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });

    if (response.ok || response.status === 404) return;

    throw new Error(
      `Failed to delete app '${appId}': HTTP ${response.status}`,
    );
  }

  private async signup(
    body: Record<string, unknown>,
  ): Promise<SignupResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/airo/v1/signup`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
    );

    if (!response.ok) {
      throw new Error(`Signup failed: HTTP ${response.status}`);
    }

    return response.json() as Promise<SignupResponse>;
  }

  private async pollUntilComplete(
    jobId: string,
  ): Promise<ProvisionResult> {
    const deadline = Date.now() + this.provisionTimeoutMs;
    const url = `${this.baseUrl}/api/airo/v1/jobs/${jobId}/apps`;
    const maxConsecutiveHttpErrors = 3;
    let consecutiveHttpErrors = 0;

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });

        if (!response.ok) {
          consecutiveHttpErrors++;
          console.warn(
            `[AABCtrlPlaneClient] poll job '${jobId}' transient HTTP ${response.status} ` +
            `(${consecutiveHttpErrors}/${maxConsecutiveHttpErrors})`,
          );
          if (consecutiveHttpErrors > maxConsecutiveHttpErrors) {
            throw new NonRetryableProvisionError(
              `Poll job '${jobId}' failed after ${maxConsecutiveHttpErrors} ` +
              `consecutive HTTP errors: HTTP ${response.status}`,
              { statusCode: response.status, jobId },
            );
          }
          await sleep(this.pollIntervalMs);
          continue;
        }

        const data: PollResponse = PollResponseSchema.parse(await response.json());
        consecutiveHttpErrors = 0;

        if (data.status === 'completed') {
          if (!data.apps.length) {
            throw new NonRetryableProvisionError(
              'Provisioning completed but no app returned',
              { jobId },
            );
          }
          const app = data.apps[0];
          return { appId: app.id, previewUrl: app.urls.preview };
        }

        if (data.status === 'failed') {
          throw new NonRetryableProvisionError(
            `Provisioning failed: ${data.error ?? 'unknown error'}`,
            { jobId },
          );
        }

        await sleep(this.pollIntervalMs);
      } catch (err) {
        if (err instanceof NonRetryableProvisionError) throw err;
        consecutiveHttpErrors++;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[AABCtrlPlaneClient] poll job '${jobId}' transient error ` +
          `(${consecutiveHttpErrors}/${maxConsecutiveHttpErrors}): ${msg}`,
        );
        if (consecutiveHttpErrors > maxConsecutiveHttpErrors) {
          throw new NonRetryableProvisionError(
            `Poll job '${jobId}' failed after ${maxConsecutiveHttpErrors} ` +
            `consecutive errors: ${msg}`,
            { jobId },
          );
        }
        await sleep(this.pollIntervalMs);
      }
    }

    throw new NonRetryableProvisionError(
      `Provisioning timed out after ${this.provisionTimeoutMs}ms`,
      { jobId },
    );
  }

}
