import { agentFetch } from '@/lib/agent-fetch';
import type { DkimOnboardingStatus } from './types';

export interface DkimClaimResult {
  claimed: boolean;
  status: DkimOnboardingStatus;
}

export interface DkimPollingState {
  createdAt?: string | null;
  pollStartedAt?: string | null;
  nextPollAt?: string | null;
  lastPolledAt?: string | null;
}

export interface DkimDuePollDecision extends DkimPollingState {
  shouldPoll: boolean;
  expired: boolean;
  status?: DkimOnboardingStatus | null;
}

/**
 * Server-to-server client for the agents DKIM endpoints. Constructed with the
 * site's agent_url (from the control-plane adapter) and the appId. agentFetch
 * mints the agent JWT server-side and sets siteId so validateAppOwnership
 * passes.
 */
export class DkimAgentClient {
  constructor(
    private readonly agentUrl: string,
    private readonly appId: string,
  ) {}

  private endpoint(path: string): string {
    return `${this.agentUrl}/apps/${this.appId}/dkim${path}`;
  }

  /**
   * Fetches the dkim_onboarding row for the given domain.
   * Polling timestamps are app+domain scoped in agents SQLite so browser
   * sessions and devices share one external-DKIM cadence.
   */
  async getRow(domain: string): Promise<DkimPollingState> {
    const res = await agentFetch(
      this.endpoint(`?domain=${encodeURIComponent(domain)}`),
      { siteId: this.appId, method: 'GET' },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.getRow failed: ${res.status} ${body}`.trim());
    }
    return (await res.json()) as DkimPollingState;
  }

  async claim(domain: string): Promise<DkimClaimResult> {
    const res = await agentFetch(this.endpoint('/claim'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.claim failed: ${res.status} ${body}`.trim());
    }
    return (await res.json()) as DkimClaimResult;
  }

  async setAccepted(domain: string, executionArn: string): Promise<void> {
    const res = await agentFetch(this.endpoint('/accepted'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain, executionArn }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.setAccepted failed: ${res.status} ${body}`.trim());
    }
  }

  async setFailed(domain: string, error: string): Promise<void> {
    const res = await agentFetch(this.endpoint('/failed'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain, error }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.setFailed failed: ${res.status} ${body}`.trim());
    }
  }

  async markActive(domain: string): Promise<void> {
    const res = await agentFetch(this.endpoint('/active'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.markActive failed: ${res.status} ${body}`.trim());
    }
  }

  async claimDuePoll(domain: string): Promise<DkimDuePollDecision> {
    const res = await agentFetch(this.endpoint('/poll/claim'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.claimDuePoll failed: ${res.status} ${body}`.trim());
    }
    return (await res.json()) as DkimDuePollDecision;
  }

  async completeDuePoll(domain: string): Promise<void> {
    const res = await agentFetch(this.endpoint('/poll/complete'), {
      siteId: this.appId,
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.completeDuePoll failed: ${res.status} ${body}`.trim());
    }
  }

  async deleteRow(domain: string, opts?: { ifStatus?: DkimOnboardingStatus }): Promise<void> {
    const qs = opts?.ifStatus ? `&ifStatus=${opts.ifStatus}` : '';
    const res = await agentFetch(this.endpoint(`?domain=${encodeURIComponent(domain)}${qs}`), {
      siteId: this.appId,
      method: 'DELETE',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DkimAgentClient.deleteRow failed: ${res.status} ${body}`.trim());
    }
  }
}
