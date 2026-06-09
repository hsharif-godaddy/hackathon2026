import { randomUUID } from 'node:crypto';
import type { RebuildBuildPageConfirmation } from './rebuild-build-page-message.js';

/** Tool name keyed by the frontend renderer registry AND the FullStory EID. */
export const REBUILD_BUILD_PAGE_TOOL_NAME = 'rebuildBuildPage';

/**
 * A deliberately-partial `@airo/ai-transport` `StreamingEvent`: the caller
 * (MessageExecutionService.publishNonTerminal) injects `conversationId`, and the
 * channel assigns id/sequence/timestamp. We carry only the fields this synthetic
 * lifecycle sets — itself a minimal subset of the real onTool* event payload (the
 * rebuild card renderer consumes only `data.tool.output`).
 */
interface RebuildToolEvent {
  conversationId?: string;
  type: 'tool_start' | 'tool_call' | 'tool_result';
  content: string;
  data: Record<string, unknown>;
  agentName: string;
}

/**
 * Surface a deterministic inner-page rebuild as a real tool lifecycle.
 *
 * Publishes tool_start → tool_call → tool_result for a synthetic `rebuildBuildPage`
 * tool call, all sharing one toolCallId so the client correlates them into a single
 * completed card. This does NOT drive the build (prompt substitution does); it only
 * makes the action visible to the tool-renderer registry and tool-call analytics.
 *
 * Each publish is awaited so its synchronous wire write completes before the next is
 * constructed; on-the-wire ordering itself comes from call order + the channel's
 * sequence number. `agentName: 'system'` marks these as server-synthesized (not
 * spoken by the turn's agent) — SSE consumers read agentName on step events, not
 * tool events. `generateId` is injectable for deterministic tests.
 */
export async function emitRebuildBuildPageToolLifecycle(
  confirmation: RebuildBuildPageConfirmation,
  publish: (event: RebuildToolEvent) => Promise<void>,
  generateId: () => string = randomUUID,
): Promise<void> {
  const id = generateId();
  const name = REBUILD_BUILD_PAGE_TOOL_NAME;
  const input = { pageSlug: confirmation.pageSlug };
  const output = {
    pageSlug: confirmation.pageSlug,
    pageTitle: confirmation.pageTitle,
    sourceUrl: confirmation.sourceUrl,
    imageCount: confirmation.imageCount,
  };

  await publish({
    type: 'tool_start',
    content: `Using ${name}...`,
    data: { toolName: name, tool: { id, name, input: {} } },
    agentName: 'system',
  });
  await publish({
    type: 'tool_call',
    content: `${name} input ready`,
    data: { toolName: name, tool: { id, name, input } },
    agentName: 'system',
  });
  // The event TYPE stays `tool_result` so the client correlates the three events
  // into one finished tool card. The content copy, however, says "started" not
  // "completed": this lifecycle is emitted at prompt-substitution time, BEFORE the
  // develop turn writes the page, so it only attests that the source-backed rebuild
  // was kicked off — not that the downstream build succeeded.
  await publish({
    type: 'tool_result',
    content: `${name} started`,
    data: { toolName: name, tool: { id, name, input, output } },
    agentName: 'system',
  });
}
