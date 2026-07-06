import { type BuilderLayoutDescriptor, DESIGN_KIT_BUILD_CANVAS_ID } from '@airo/shared'
import { describe, expect, it } from 'vitest'

import { persistBuilderLayout, updateBuilderLayout } from '../update-builder-layout.js'

const IMMERSIVE: BuilderLayoutDescriptor = {
  version: 1,
  layout: 'immersive',
  pinnedSurface: { canvasId: DESIGN_KIT_BUILD_CANVAS_ID },
}

function makeDeps() {
  const calls: string[] = []
  const merged: Array<{ appId: string; patch: unknown }> = []
  const published: Array<{ convId: string; type: string; data: unknown }> = []
  return {
    calls,
    merged,
    published,
    deps: {
      metadataRepo: {
        merge(appId: string, patch: Record<string, unknown>) {
          calls.push('merge')
          merged.push({ appId, patch })
          return patch
        },
      },
      eventChannel: {
        async publish(convId: string, event: { type: string; data: unknown }) {
          calls.push('publish')
          published.push({ convId, type: event.type, data: event.data })
          return event
        },
      },
      registry: {
        getConversationsByApp() {
          return ['conv-1', 'conv-2']
        },
      },
    },
  }
}

describe('persistBuilderLayout', () => {
  it('merges the descriptor under the builderLayout key without publishing', () => {
    const { calls, merged, deps } = makeDeps()
    persistBuilderLayout('app1234567', IMMERSIVE, deps)
    expect(calls).toEqual(['merge'])
    expect((merged[0].patch as { builderLayout: BuilderLayoutDescriptor }).builderLayout).toEqual(IMMERSIVE)
  })
})

describe('updateBuilderLayout', () => {
  it('persists the descriptor BEFORE publishing (durability)', async () => {
    const { calls, deps } = makeDeps()
    await updateBuilderLayout('app1234567', IMMERSIVE, deps)
    expect(calls[0]).toBe('merge')
    expect(calls.slice(1).every((c) => c === 'publish')).toBe(true)
  })

  it('publishes a builder_layout event carrying the descriptor to every active conversation', async () => {
    const { published, deps } = makeDeps()
    await updateBuilderLayout('app1234567', IMMERSIVE, deps)
    expect(published.map((p) => p.convId)).toEqual(['conv-1', 'conv-2'])
    expect(published.every((p) => p.type === 'builder_layout')).toBe(true)
    const data = published[0].data as { appId: string; builderLayout: BuilderLayoutDescriptor }
    expect(data.appId).toBe('app1234567')
    expect(data.builderLayout).toEqual(IMMERSIVE)
  })

  it('still persists even when there are no active conversations', async () => {
    const { calls, deps } = makeDeps()
    deps.registry.getConversationsByApp = () => []
    await updateBuilderLayout('app1234567', IMMERSIVE, deps)
    expect(calls).toEqual(['merge'])
  })

  it('does not throw when the event channel is unavailable', async () => {
    const { deps } = makeDeps()
    await expect(
      updateBuilderLayout('app1234567', IMMERSIVE, { ...deps, eventChannel: null, registry: null }),
    ).resolves.toBeUndefined()
  })

  it('continues publishing to later conversations when one publish fails', async () => {
    const { deps } = makeDeps()
    const reached: string[] = []
    deps.eventChannel.publish = async (convId: string) => {
      reached.push(convId)
      if (convId === 'conv-1') throw new Error('stream gone')
      return undefined
    }
    await expect(updateBuilderLayout('app1234567', IMMERSIVE, deps)).resolves.toBeUndefined()
    expect(reached).toEqual(['conv-1', 'conv-2'])
  })
})
