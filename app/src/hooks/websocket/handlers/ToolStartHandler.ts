import { mapToolStart } from '@/hooks/shared/toolMappers'
import { useDevelopPageStore } from '@/stores/useDevelopPageStore'
import { logActionEvent } from '@/utils/instrumentation'
import type { DataHandlerContext, MessageHandler, WebSocketMessage } from './types'

type RebuildPhase = 'initial' | 'follow_up'

// `appId` is auto-injected into customProperties downstream by
// `mergeCustomPropertiesWithAppId` in instrumentation.ts — do not add it here.
function fireRebuildStartEid(tool: { input?: Record<string, unknown> }): void {
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

export class ToolStartHandler implements MessageHandler {
  readonly type = 'tool_start'

  async handle(data: WebSocketMessage, context: DataHandlerContext): Promise<void> {
    if (data.data?.tool) {
      const tool = data.data.tool as { id?: string; name: string; input?: Record<string, unknown> }
      context.actions.addToolStartSegment(mapToolStart(tool as any))
      if (tool.name === 'websiteRebuild') {
        fireRebuildStartEid(tool)
      }
    }
  }
}
