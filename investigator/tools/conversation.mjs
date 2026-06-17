import { tool } from 'ai';
import { z } from 'zod';
import { readFile as _readFile } from 'node:fs/promises';

// Default per-call character window. The transcript can be large (many turns
// with tool calls); the agent pages with `offset` rather than pulling it all
// into one tool result.
const DEFAULT_MAX_CHARS = 40_000;
const HARD_MAX_CHARS = 60_000;

/**
 * Conversation-transcript tool for the in-process loop.
 *
 * CLI parity: the claude-CLI agent could `Read` $CONVERSATIONS_PATH directly.
 * The in-process loop has no generic file Read, so this exposes the agent
 * conversation (what the customer asked + how the develop-agent responded) as
 * a bounded, paginated tool — critical evidence for "was this feature actually
 * requested?" and for tracing a log symptom back to the turn that caused it.
 *
 * @param {{ conversationsPath?: string, readFileImpl?: typeof _readFile }} [opts]
 * @returns {{ readConversation: ReturnType<typeof tool> }}
 */
export function createConversationTools({ conversationsPath = '', readFileImpl = _readFile } = {}) {
  const readConversation = tool({
    description: 'Read the customer <-> develop-agent conversation transcript: what the customer asked and how the agent responded. Use to confirm whether a "missing" page/feature was actually requested (AAB builds incrementally — unrequested = by-design, not a defect) and to correlate a log symptom to the agent turn that produced it. Returns a bounded character window of the transcript JSON; page with `offset` for long transcripts.',
    inputSchema: z.object({
      offset: z.number().int().min(0).default(0).describe('character offset into the transcript for paging'),
      maxChars: z.number().int().min(1).max(HARD_MAX_CHARS).default(DEFAULT_MAX_CHARS).describe('max characters to return this call'),
    }),
    execute: async ({ offset, maxChars }) => {
      if (!conversationsPath) {
        return { ok: false, error: 'no conversation transcript available this run' };
      }
      try {
        const raw = await readFileImpl(conversationsPath, 'utf-8');
        // Best-effort conversation count (transcript is a JSON array of turns).
        let totalConversations = null;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) totalConversations = parsed.length;
        } catch {
          // Not a JSON array — still return the raw text window below.
        }
        const text = raw.slice(offset, offset + maxChars);
        return {
          ok: true,
          totalConversations,
          totalChars: raw.length,
          offset,
          text,
          truncated: offset + maxChars < raw.length,
        };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    },
  });

  return { readConversation };
}
