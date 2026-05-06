import { z } from 'zod';

export interface ProvisionResult {
  appId: string;
  previewUrl: string;
}

export interface AABCtrlPlaneClientConfig {
  baseUrl: string;
  provisionTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
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
const LOCAL_SUB = 'local-sub-001';
const LOCAL_SYS = 'local-sys-001';

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

  constructor(config: AABCtrlPlaneClientConfig) {
    this.baseUrl = config.baseUrl;
    this.provisionTimeoutMs =
      config.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS;
    this.pollIntervalMs =
      config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.requestTimeoutMs =
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async provisionApp(
    options?: Record<string, unknown>,
  ): Promise<ProvisionResult> {
    const { statusJobId } = await this.signup(options ?? {});
    return this.pollUntilComplete(statusJobId);
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

    while (Date.now() < deadline) {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });

      if (!response.ok) {
        throw new Error(
          `Poll job '${jobId}' failed: HTTP ${response.status}`,
        );
      }

      const data: PollResponse = PollResponseSchema.parse(await response.json());

      if (data.status === 'completed') {
        if (!data.apps.length) {
          throw new Error(
            'Provisioning completed but no app returned',
          );
        }
        const app = data.apps[0];
        return { appId: app.id, previewUrl: app.urls.preview };
      }

      if (data.status === 'failed') {
        throw new Error(
          `Provisioning failed: ${data.error ?? 'unknown error'}`,
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new Error(
      `Provisioning timed out after ${this.provisionTimeoutMs}ms`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
