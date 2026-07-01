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
  /**
   * Timeout for the reset request specifically. A reset that restarts
   * containers blocks server-side until the preview is serving again
   * (the control plane polls `/airo/health` for up to ~45s), so the reset
   * request must allow more time than a normal request. Defaults to
   * DEFAULT_RESET_TIMEOUT_MS, comfortably above the server's readiness window.
   */
  resetTimeoutMs?: number;
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

const ResetResponseSchema = z.object({
  restarted: z.boolean().optional(),
  restartError: z.string().optional(),
  ready: z.boolean().optional(),
  readyError: z.string().optional(),
});

type PollResponse = z.infer<typeof PollResponseSchema>;

const DEFAULT_PROVISION_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
// Above the control plane's preview-readiness window (~45s) plus margin: a
// reset that restarts containers blocks until the preview serves again, so the
// client must not abort mid-readiness-poll.
const DEFAULT_RESET_TIMEOUT_MS = 90_000;
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
  private readonly resetTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;

  constructor(config: AABCtrlPlaneClientConfig) {
    this.baseUrl = config.baseUrl;
    // Only honor PROVISION_TIMEOUT_MS when it parses to a positive finite number;
    // a typo/0/negative would otherwise become an immediate provision timeout.
    const envProvisionTimeout: number = Number(process.env.PROVISION_TIMEOUT_MS);
    this.provisionTimeoutMs =
      config.provisionTimeoutMs ??
      (Number.isFinite(envProvisionTimeout) && envProvisionTimeout > 0
        ? envProvisionTimeout
        : DEFAULT_PROVISION_TIMEOUT_MS);
    this.pollIntervalMs =
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.resetTimeoutMs =
      config.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
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

  /**
   * Hard-resets an app's workspace to a known commit (or HEAD when omitted)
   * and restarts its containers so dependencies re-sync. Used by stateful
   * injection to reuse one pre-built app across trials. Requires the
   * control-plane reset endpoint (POST .../apps/{appId}/reset).
   *
   * When a restart is requested, this waits for the control plane to confirm
   * the preview is serving again (`ready:true`) before resolving, and throws
   * otherwise. A restart that relaunches the container but leaves the preview
   * un-served produces a silent no-op trial — the dominant cause of the
   * post-reset trial exclusions at n=7 — so a not-ready reset is treated as a
   * hard failure rather than allowed to poison the next trial.
   */
  async resetApp(
    appId: string,
    options?: { commit?: string; restart?: boolean },
  ): Promise<void> {
    const url =
      `${this.baseUrl}/api/airo/v1/subscriptions` +
      `/${LOCAL_SUB}/systems/${LOCAL_SYS}/apps/${appId}/reset`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(options?.commit !== undefined && { commit: options.commit }),
        ...(options?.restart !== undefined && { restart: options.restart }),
      }),
      // A reset that restarts containers blocks server-side until the preview
      // is serving again, so allow more time than a normal request.
      signal: AbortSignal.timeout(this.resetTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to reset app '${appId}': HTTP ${response.status}`,
      );
    }

    // A 200 can still be a degraded reset: the container restart may have
    // failed (handler reports restarted:false + restartError), or it may have
    // restarted but not come back up to serve traffic (ready:false +
    // readyError) while the git reset succeeded. Running a trial against an
    // un-restarted app means stale node_modules vs the reset package.json;
    // running against a not-yet-ready app means the agent hits a dead preview
    // and no-ops. Both are the exact corruption stateful injection exists to
    // prevent, so treat either as a hard failure.
    const restartRequested = options?.restart !== false;
    if (restartRequested) {
      const parsed = ResetResponseSchema.safeParse(
        await response.json().catch(() => null),
      );
      // An unparseable/absent body when a restart was requested is itself a
      // degraded signal: we cannot confirm the restart succeeded, so fail loud
      // rather than let `restarted` default to undefined and skip the check.
      if (!parsed.success || parsed.data.restarted !== true) {
        const reason = parsed.success
          ? (parsed.data.restartError ?? 'unknown error')
          : 'reset response body missing or malformed';
        throw new Error(
          `Reset of app '${appId}' left containers un-restarted ` +
          `(degraded — stale dependencies): ${reason}`,
        );
      }
      // Restart succeeded but the preview never came back to serving — the
      // next trial would run against a dead preview and no-op.
      if (parsed.data.ready !== true) {
        throw new Error(
          `Reset of app '${appId}' restarted containers but the preview ` +
          `did not become ready (degraded — trial would no-op): ` +
          `${parsed.data.readyError ?? 'unknown error'}`,
        );
      }
    }
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
