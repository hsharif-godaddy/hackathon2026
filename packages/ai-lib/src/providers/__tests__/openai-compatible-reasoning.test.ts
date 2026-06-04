import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../utils/s2s-auth.js', () => ({
  getS2SToken: vi.fn().mockResolvedValue('test-token'),
  refreshS2SToken: vi.fn().mockResolvedValue('refreshed-token'),
  isS2SAuthEnabled: vi.fn().mockReturnValue(false),
  getS2SProviderConfig: vi.fn().mockResolvedValue(null),
  getDefaultAnthropicProxyEndpoint: vi.fn().mockReturnValue('https://gocode.example.com'),
}))

const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
  new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ),
)

vi.stubGlobal('fetch', fetchSpy)

function requestBodyFromCall(callIndex = 0): Record<string, unknown> {
  const call = fetchSpy.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string)
}

describe('openai-compatible reasoning round-trip', () => {
  beforeEach(function reset() {
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.OPENAI_BASE_URL = 'https://api.example.com/v1'
  })

  it('serializes assistant reasoning parts to reasoning_content in outgoing requests', async function reasoningContent() {
    const { getModel } = await import('../unified-provider.js')
    const model = await getModel('azure/Kimi-K2.6-thinking')

    await model.doGenerate({
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Let me think about this...' },
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'readFile',
              input: { path: 'a.txt' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_1',
              toolName: 'readFile',
              output: { type: 'text', value: 'file contents' },
            },
          ],
        },
      ],
    })

    const body = requestBodyFromCall()
    const messages = body.messages as Array<Record<string, unknown>>
    const assistantMsg = messages.find((message) => message.role === 'assistant')

    expect(assistantMsg?.reasoning_content).toBe('Let me think about this...')
    expect(assistantMsg?.tool_calls).toBeDefined()
  })
})
