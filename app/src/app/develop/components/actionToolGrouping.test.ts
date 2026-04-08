import { describe, expect, it } from 'vitest'

import type { ToolCall } from '@/stores/useStreamingConversationStore'
import { groupConsecutiveActionTools, isActionToolGroupEligible } from './actionToolGrouping'
import type { ContentBlock } from './contentBlocks'

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: overrides.id ?? 'tool-1',
    name: overrides.name ?? 'viewLogs',
    input: overrides.input ?? {},
    status: overrides.status ?? 'completed',
    result: overrides.result,
    error: overrides.error,
    startTime: overrides.startTime,
    endTime: overrides.endTime,
    duration: overrides.duration,
    partialInput: overrides.partialInput
  }
}

function createToolBlock(order: number, toolCall: ToolCall): ContentBlock {
  return {
    type: 'tool',
    order,
    toolCall
  }
}

describe('actionToolGrouping', () => {
  it('treats compact action tools as eligible and rich inline tools as ineligible', () => {
    expect(isActionToolGroupEligible(createToolCall({ name: 'viewLogs' }))).toBe(true)
    expect(isActionToolGroupEligible(createToolCall({ name: 'readFile' }))).toBe(true)
    expect(isActionToolGroupEligible(createToolCall({ name: 'unknownNewTool' }))).toBe(false)
    expect(isActionToolGroupEligible(createToolCall({ name: 'media__generate_image' }))).toBe(false)
    expect(isActionToolGroupEligible(createToolCall({ name: 'widgetRender' }))).toBe(false)
  })

  it('groups consecutive eligible actions into a single action-group block', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'text',
        content: 'Starting work',
        order: 0
      },
      createToolBlock(1, createToolCall({ id: 'logs', name: 'viewLogs' })),
      createToolBlock(2, createToolCall({ id: 'restart', name: 'serverRestart' })),
      createToolBlock(3, createToolCall({ id: 'git', name: 'gitOperation' })),
      {
        type: 'text',
        content: 'Done',
        order: 4
      }
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped).toHaveLength(3)
    expect(grouped[1]).toMatchObject({
      type: 'action-group',
      order: 1
    })
    expect(grouped[1]?.toolCalls?.map((toolCall) => toolCall.id)).toEqual(['logs', 'restart', 'git'])
  })

  it('does not group a single eligible action', () => {
    const singleAction = createToolBlock(0, createToolCall({ id: 'logs', name: 'viewLogs' }))

    const grouped = groupConsecutiveActionTools([singleAction])

    expect(grouped).toEqual([singleAction])
  })

  it('keeps trailing running tools outside the action group', () => {
    const blocks: ContentBlock[] = [
      createToolBlock(0, createToolCall({ id: 'done1', name: 'fileRead', status: 'completed' })),
      createToolBlock(1, createToolCall({ id: 'done2', name: 'fileEdit', status: 'completed' })),
      createToolBlock(2, createToolCall({ id: 'done3', name: 'gitOperation', status: 'completed' })),
      createToolBlock(3, createToolCall({ id: 'active', name: 'terminalCommand', status: 'running' })),
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped).toHaveLength(2)
    expect(grouped[0]).toMatchObject({ type: 'action-group' })
    expect(grouped[0]?.toolCalls?.map((tc) => tc.id)).toEqual(['done1', 'done2', 'done3'])
    expect(grouped[1]).toMatchObject({ type: 'tool' })
    expect(grouped[1]?.toolCall?.id).toBe('active')
  })

  it('does not group when all tools are running', () => {
    const blocks: ContentBlock[] = [
      createToolBlock(0, createToolCall({ id: 'r1', name: 'fileRead', status: 'running' })),
      createToolBlock(1, createToolCall({ id: 'r2', name: 'fileEdit', status: 'running' })),
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped).toHaveLength(2)
    expect(grouped.every((b) => b.type === 'tool')).toBe(true)
  })

  it('keeps single completed + single running as separate standalone blocks', () => {
    const blocks: ContentBlock[] = [
      createToolBlock(0, createToolCall({ id: 'done', name: 'fileRead', status: 'completed' })),
      createToolBlock(1, createToolCall({ id: 'active', name: 'fileEdit', status: 'running' })),
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped).toHaveLength(2)
    expect(grouped[0]?.toolCall?.id).toBe('done')
    expect(grouped[1]?.toolCall?.id).toBe('active')
  })

  it('groups all completed tools normally (no running tools)', () => {
    const blocks: ContentBlock[] = [
      createToolBlock(0, createToolCall({ id: 'a', name: 'fileRead', status: 'completed' })),
      createToolBlock(1, createToolCall({ id: 'b', name: 'fileEdit', status: 'completed' })),
      createToolBlock(2, createToolCall({ id: 'c', name: 'gitOperation', status: 'completed' })),
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toMatchObject({ type: 'action-group' })
    expect(grouped[0]?.toolCalls).toHaveLength(3)
  })

  it('breaks action groups on text, rich tool blocks, and existing tool groups', () => {
    const blocks: ContentBlock[] = [
      createToolBlock(0, createToolCall({ id: 'logs', name: 'viewLogs' })),
      createToolBlock(1, createToolCall({ id: 'planner', name: 'askQuestion' })),
      createToolBlock(2, createToolCall({ id: 'restart', name: 'serverRestart' })),
      {
        type: 'tool-group',
        order: 3,
        toolCalls: [createToolCall({ id: 'media-1', name: 'media' }), createToolCall({ id: 'media-2', name: 'media' })]
      },
      createToolBlock(4, createToolCall({ id: 'git', name: 'gitOperation' })),
      createToolBlock(5, createToolCall({ id: 'status', name: 'serverStatus' }))
    ]

    const grouped = groupConsecutiveActionTools(blocks)

    expect(grouped.map((block) => block.type)).toEqual(['tool', 'tool', 'tool', 'tool-group', 'action-group'])
    expect(grouped[4]?.toolCalls?.map((toolCall) => toolCall.id)).toEqual(['git', 'status'])
  })
})
