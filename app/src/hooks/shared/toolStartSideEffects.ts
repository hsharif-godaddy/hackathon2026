/**
 * Shared Tool-Start Side Effects
 *
 * Fires EIDs that must trigger on `tool_start` (before the tool completes).
 * Called by both the WS ToolStartHandler and the SSE handler in useSSEChat,
 * so the behavior stays identical across transports (see
 * `packages/ai-transport/CLAUDE.md` — shared client behavior lives here).
 *
 * Skill analytics do NOT live here: they fire on `tool_result` (via
 * `trackToolResult` in completionSideEffects.ts), where the parsed tool input
 * and the server-attached `skillName` are available. `tool_start` frames carry
 * empty input, so the only EID anchored here is the website-rebuild start.
 *
 * `appId` is auto-injected into customProperties downstream by
 * `mergeCustomPropertiesWithAppId` in instrumentation.ts — do not add it here.
 */

import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logActionEvent } from '@/utils/instrumentation'

type RebuildPhase = 'initial' | 'follow_up'

type ToolStartShape = {
  name: string
  input?: Record<string, unknown>
}

function fireRebuildStartEid(tool: ToolStartShape): void {
  const phase: RebuildPhase = useDevelopPageStore.getState().app?.initialBuildComplete
    ? 'follow_up'
    : 'initial'
  const url = typeof tool.input?.url === 'string' ? tool.input.url : ''
  logActionEvent({
    eid: 'develop.rebuild.start',
    action: 'load',
    customProperties: { phase, sourceUrl: url },
  })()
}

/**
 * Single dispatch entry point, called by both transports after the tool_start
 * segment has been added to the streaming store.
 */
export function handleToolStartSideEffects(tool: ToolStartShape): void {
  if (tool.name === 'websiteRebuild') {
    fireRebuildStartEid(tool)
  }
}
