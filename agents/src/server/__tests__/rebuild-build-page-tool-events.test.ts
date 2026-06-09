import { describe, it, expect, vi } from 'vitest'
import { emitRebuildBuildPageToolLifecycle } from '../rebuild-build-page-tool-events.js'

describe('emitRebuildBuildPageToolLifecycle', () => {
  const confirmation = {
    pageSlug: 'about',
    pageTitle: 'About',
    sourceUrl: 'https://example.com/about',
    imageCount: 4,
  }

  it('publishes tool_start, tool_call, tool_result sharing one toolCallId', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    await emitRebuildBuildPageToolLifecycle(confirmation, publish, () => 'fixed-id')

    expect(publish).toHaveBeenCalledTimes(3)
    const [start, call, result] = publish.mock.calls.map(c => c[0])

    expect(start.type).toBe('tool_start')
    expect(call.type).toBe('tool_call')
    expect(result.type).toBe('tool_result')

    for (const ev of [start, call, result]) {
      expect(ev.data.toolName).toBe('rebuildBuildPage')
      expect(ev.data.tool.id).toBe('fixed-id')
      expect(ev.data.tool.name).toBe('rebuildBuildPage')
      expect(ev.agentName).toBe('system')
    }
    expect(call.data.tool.input).toEqual({ pageSlug: 'about' })
    expect(result.data.tool.output).toEqual({
      pageSlug: 'about',
      pageTitle: 'About',
      sourceUrl: 'https://example.com/about',
      imageCount: 4,
    })
  })

  it('does not claim the build completed (copy is emitted before the develop turn)', async () => {
    const publish = vi.fn().mockResolvedValue(undefined)
    await emitRebuildBuildPageToolLifecycle(confirmation, publish, () => 'x')
    const result = publish.mock.calls.map(c => c[0]).find(e => e.type === 'tool_result')
    expect(result.content).not.toMatch(/completed/i)
  })

  it('emits in start → call → result order', async () => {
    const order: string[] = []
    const publish = vi.fn(async (ev: { type: string }) => { order.push(ev.type) })
    await emitRebuildBuildPageToolLifecycle(confirmation, publish, () => 'x')
    expect(order).toEqual(['tool_start', 'tool_call', 'tool_result'])
  })
})
