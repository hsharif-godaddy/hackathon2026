import { z } from 'zod';
import { mockAuthToken } from './aab-client.js';

const SeedSummaryResponseSchema = z.object({ summaryId: z.string() });
const RegisterAppResponseSchema = z.object({ app: z.object({ id: z.string() }) });

// Seeding is a fast local DB write; a generous ceiling that still fails loud if
// the agents process hangs rather than letting trial setup wait forever.
const SEED_SUMMARY_TIMEOUT_MS = 30_000;

/**
 * A raw prior conversation turn to replay verbatim as recent (un-summarized)
 * history. Seeded into the conversation the trial resolves into.
 */
export interface SeedPriorTurn {
  sender: 'user' | 'agent';
  content: string;
}

export interface SeedSummaryInput {
  /**
   * The prefabricated, already-compacted conversation state. Author it with the
   * same sections the live summarizer emits (## State / ## Completed /
   * ## Decisions / ## Pending) so the seeded context matches what the agent
   * would normally carry mid-conversation.
   */
  summaryText: string;
  /** Synthetic count of messages the summary stands in for. Default 0. */
  messageCount?: number;
  /** Synthetic original token count the summary represents. Default = summary tokens. */
  originalTokenCount?: number;
  /** Model label recorded on the summary row. Default 'eval-seed'. */
  modelUsed?: string;
  /**
   * Optional raw prior turns replayed as recent un-summarized history (higher
   * fidelity: summary + a tail of recent turns, as production carries at steady
   * state). The agent reads these from the conversation the trial resolves
   * into, alongside the app-scoped summary. Omit for summary-only seeding.
   */
  priorTurns?: SeedPriorTurn[];
}

/**
 * HTTP client for the AAB agents REST API.
 * Used by eval scenarios to register and clean up per-trial apps, and to seed
 * prefabricated conversation summaries for stateful injection.
 */
export class AABAgentsApiClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Pre-fabricates a conversation summary for an app so a fresh run starts
   * mid-conversation. Hits the agents debug endpoint, which writes the same
   * summary row the BackgroundSummarizer would; the agent then injects it on
   * turn 0 via its normal latest-summary load path. Used by stateful injection
   * to pair a filesystem reset (pinned commit) with seeded conversation state.
   *
   * Sends an unsigned mock JWT so AUTH_TYPE=mock populates the agent context
   * (same handshake the SSE chat client uses); the seeded summary is scoped to
   * the same workspace the trial then runs against.
   */
  async seedSummary(appId: string, input: SeedSummaryInput): Promise<string> {
    const response = await fetch(`${this.baseUrl}/debug/${appId}/seed-summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mockAuthToken({ siteId: appId })}`,
      },
      body: JSON.stringify({
        summaryText: input.summaryText,
        ...(input.messageCount !== undefined && { messageCount: input.messageCount }),
        ...(input.originalTokenCount !== undefined && { originalTokenCount: input.originalTokenCount }),
        ...(input.modelUsed !== undefined && { modelUsed: input.modelUsed }),
        ...(input.priorTurns !== undefined && { priorTurns: input.priorTurns }),
      }),
      // Parity with AABCtrlPlaneClient: fail loud on a hung agents process during
      // seeding rather than letting trial setup hang indefinitely.
      signal: AbortSignal.timeout(SEED_SUMMARY_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Surface the server's error/details payload (the handler populates it on
      // 400 validation failures and 500s) so seed failures are diagnosable from
      // the harness without server-log access.
      const detail: string = await response.text().catch(() => '');
      throw new Error(
        `Failed to seed summary for app '${appId}': HTTP ${response.status}` +
        (detail ? ` — ${detail}` : ''),
      );
    }

    // Guard the success body too: a malformed/empty 2xx would otherwise yield
    // `undefined` silently (or a raw SyntaxError with no app/op context),
    // defeating the diagnosability the failure branch above provides.
    const parsed = SeedSummaryResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new Error(
        `Seed summary for app '${appId}' returned HTTP ${response.status} ` +
        'but a malformed body (missing summaryId)',
      );
    }
    return parsed.data.summaryId;
  }

  /**
   * Registers a new app via POST /apps/register, using siteId as
   * the app's ID. Returns the registered app ID.
   */
  async registerApp(id: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/apps/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: id, name: `eval-${id}` }),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to register app '${id}': HTTP ${response.status}`,
      );
    }

    const parsed = RegisterAppResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new Error(
        `Register app '${id}' returned HTTP ${response.status} but a malformed ` +
        'body (missing app.id)',
      );
    }
    return parsed.data.app.id;
  }

  /**
   * Deletes an app by ID via DELETE /apps/:id.
   * Silently ignores 404 (app already removed).
   */
  async deleteApp(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/apps/${id}`, {
      method: 'DELETE',
    });

    if (response.ok || response.status === 404) return;

    throw new Error(
      `Failed to delete app '${id}': HTTP ${response.status}`,
    );
  }
}
