import { describe, it, expect, vi } from 'vitest'
import { runPreflightTools } from '../preflight-tools.js'

describe('runPreflightTools', () => {
  it('returns synthesized assistant tool-call + tool result pair', async () => {
    const tool = {
      execute: vi.fn().mockResolvedValue('catalog markdown here'),
      description: '',
      parameters: {},
    }
    const messages = await runPreflightTools({
      preflightTools: ['listBrandKits'],
      tools: { listBrandKits: tool },
      context: { metadata: { appId: 'a' } },
    })
    expect(messages).toHaveLength(2)
    const assistant = messages[0] as any
    expect(assistant.role).toBe('assistant')
    expect(assistant.content[0].type).toBe('tool-call')
    expect(assistant.content[0].toolName).toBe('listBrandKits')
    expect(assistant.content[0].input).toEqual({})

    const toolMsg = messages[1] as any
    expect(toolMsg.role).toBe('tool')
    expect(toolMsg.content[0].type).toBe('tool-result')
    expect(toolMsg.content[0].output.value).toContain('catalog markdown here')
    expect(toolMsg.content[0].toolCallId).toBe(assistant.content[0].toolCallId)
  })

  it('returns empty array when no preflight tools declared', async () => {
    const result = await runPreflightTools({ preflightTools: [], tools: {}, context: {} })
    expect(result).toEqual([])
  })

  it('skips tools that throw, logs warning, and continues with the rest', async () => {
    const okTool = { execute: vi.fn().mockResolvedValue('ok'), description: '', parameters: {} }
    const badTool = { execute: vi.fn().mockRejectedValue(new Error('boom')), description: '', parameters: {} }
    const warnSpy = vi.fn()
    const messages = await runPreflightTools({
      preflightTools: ['bad', 'ok'],
      tools: { bad: badTool, ok: okTool },
      context: {},
      logger: { warn: warnSpy },
    })
    expect(messages).toHaveLength(2)
    expect((messages[1] as any).content[0].output.value).toContain('ok')
    expect(warnSpy).toHaveBeenCalledWith('preflight.tool_failed', { tool: 'bad', err: 'boom' })
  })

  it('passes context wrapped as experimental_context', async () => {
    const tool = { execute: vi.fn().mockResolvedValue('ok'), description: '', parameters: {} }
    const ctx = { metadata: { appId: 'test-app' } }
    await runPreflightTools({ preflightTools: ['t'], tools: { t: tool }, context: ctx })
    expect(tool.execute).toHaveBeenCalledWith({}, { experimental_context: ctx })
  })

  it('skips when tool is not registered', async () => {
    const result = await runPreflightTools({ preflightTools: ['nonexistent'], tools: {}, context: {} })
    expect(result).toEqual([])
  })
})
