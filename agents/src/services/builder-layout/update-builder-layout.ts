import { type BuilderLayoutDescriptor } from '@airo/shared'

import { AppMetadataRepository } from '../../database/repositories/AppMetadataRepository.js'
import { Logger } from '../../logging/index.js'
import { getEventChannel } from '../../server/agent-runtime.js'
import { getSSERegistry } from '../../server/sse/registry-singleton.js'

const logger = Logger.create({ component: 'update-builder-layout' })

interface MetadataMerger {
  merge(appId: string, patch: Record<string, unknown>): unknown
}

interface LayoutPublisher {
  publish(
    conversationId: string,
    event: {
      conversationId: string
      type: string
      content: string
      data: Record<string, unknown>
      agentName: string
    },
  ): Promise<unknown>
}

interface ConversationLister {
  getConversationsByApp(appId: string): string[]
}

export interface BuilderLayoutDeps {
  metadataRepo: MetadataMerger
  eventChannel: LayoutPublisher | null
  registry: ConversationLister | null
}

function defaultDeps(): BuilderLayoutDeps {
  return {
    metadataRepo: new AppMetadataRepository(),
    eventChannel: getEventChannel(),
    registry: getSSERegistry(),
  }
}

// Persist the durable descriptor. Persist BEFORE emitting any SSE so a reload/GET between the
// write and the event never reads a stale app_metadata.builderLayout. Publishing is a separate
// step (publishLayoutEvent).
export function persistBuilderLayout(
  appId: string,
  builderLayout: BuilderLayoutDescriptor,
  deps: BuilderLayoutDeps = defaultDeps(),
): void {
  deps.metadataRepo.merge(appId, { builderLayout })
}

export async function publishLayoutEvent(
  appId: string,
  builderLayout: BuilderLayoutDescriptor,
  deps: BuilderLayoutDeps = defaultDeps(),
): Promise<void> {
  if (!deps.eventChannel || !deps.registry) return
  const eventChannel = deps.eventChannel
  for (const conversationId of deps.registry.getConversationsByApp(appId)) {
    try {
      await eventChannel.publish(conversationId, {
        conversationId,
        type: 'builder_layout',
        content: '',
        data: { appId, builderLayout },
        agentName: 'system',
      })
    } catch (error) {
      logger.warn('updateBuilderLayout.sse_emit.failed', {
        appId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

// Persist-then-publish in one call, for callers that emit no other event. Callers that also emit
// a related event should instead call persistBuilderLayout() first, emit that event, then
// publishLayoutEvent() — so durability holds and their event ordering is under their control.
export async function updateBuilderLayout(
  appId: string,
  builderLayout: BuilderLayoutDescriptor,
  deps: BuilderLayoutDeps = defaultDeps(),
): Promise<void> {
  persistBuilderLayout(appId, builderLayout, deps)
  await publishLayoutEvent(appId, builderLayout, deps)
}
