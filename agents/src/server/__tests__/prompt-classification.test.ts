import { describe, it, expect, vi, beforeEach } from 'vitest'

import { runClassification, isContinuationTurn } from '../prompt-classification.js'

describe('isContinuationTurn', () => {
  it('returns false when history is empty', () => {
    expect(isContinuationTurn([], ['askQuestion'])).toBe(false)
  })

  it('returns false when stopAfterTools is empty', () => {
    const history = [{ role: 'assistant', content: [{ type: 'tool-call', toolName: 'askQuestion' }] }]
    expect(isContinuationTurn(history, [])).toBe(false)
  })

  it('returns true when last assistant turn has a matching stop tool', () => {
    const history = [
      { role: 'user', content: 'build a site' },
      { role: 'assistant', content: [{ type: 'text', text: 'Sure' }, { type: 'tool-call', toolName: 'askQuestion' }] },
    ]
    expect(isContinuationTurn(history, ['askQuestion', 'handoff'])).toBe(true)
  })

  it('returns false when last assistant turn has non-matching tool', () => {
    const history = [
      { role: 'user', content: 'build a site' },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'runAgent' }] },
    ]
    expect(isContinuationTurn(history, ['askQuestion'])).toBe(false)
  })

  it('returns false when last assistant turn has no tool calls', () => {
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello!' }] },
    ]
    expect(isContinuationTurn(history, ['askQuestion'])).toBe(false)
  })

  it('only checks the last assistant message', () => {
    const history = [
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'askQuestion' }] },
      { role: 'user', content: 'blue' },
      { role: 'assistant', content: [{ type: 'text', text: 'Done' }] },
      { role: 'user', content: 'now change the font' },
    ]
    expect(isContinuationTurn(history, ['askQuestion'])).toBe(false)
  })
})

describe('runClassification', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when agent has no classifier methods', async () => {
    const result = await runClassification({
      agentConfig: {},
      prompt: 'build a site',
      historyMessages: [],
      isInitialPrompt: true,
      appId: 'app1',
    })
    expect(result).toBeNull()
  })

  it('calls classifyInitialPrompt when isInitialPrompt is true', async () => {
    const classifyInitialPrompt = vi.fn().mockResolvedValue({ class: 'complex', reason: 'multi-page site' })
    const classifyPrompt = vi.fn()

    const result = await runClassification({
      agentConfig: { classifyInitialPrompt, classifyPrompt },
      prompt: 'build an e-commerce site',
      historyMessages: [],
      isInitialPrompt: true,
      appId: 'app1',
      templateId: 'deep-build',
    })

    expect(classifyInitialPrompt).toHaveBeenCalledWith({
      prompt: 'build an e-commerce site',
      appId: 'app1',
      conversationId: undefined,
      isInitialPrompt: true,
      templateId: 'deep-build',
      attachments: undefined,
    })
    expect(classifyPrompt).not.toHaveBeenCalled()
    expect(result).toEqual({
      role: 'user',
      content: '## Request classification\n\n<classification class="complex">multi-page site</classification>',
    })
  })

  it('calls classifyPrompt when isInitialPrompt is false and not a continuation', async () => {
    const classifyInitialPrompt = vi.fn()
    const classifyPrompt = vi.fn().mockResolvedValue({ class: 'simple', reason: 'single file edit' })

    const history = [
      { role: 'user', content: 'build a site' },
      { role: 'assistant', content: [{ type: 'text', text: 'Done building' }] },
    ]

    const result = await runClassification({
      agentConfig: { classifyInitialPrompt, classifyPrompt, stopAfterTools: ['askQuestion'] },
      prompt: 'change the button to blue',
      historyMessages: history,
      isInitialPrompt: false,
      appId: 'app1',
    })

    expect(classifyInitialPrompt).not.toHaveBeenCalled()
    expect(classifyPrompt).toHaveBeenCalledWith({
      prompt: 'change the button to blue',
      appId: 'app1',
      conversationId: undefined,
      isInitialPrompt: false,
      templateId: undefined,
      attachments: undefined,
    })
    expect(result!.content).toContain('class="simple"')
  })

  it('skips classification on continuation turns', async () => {
    const classifyPrompt = vi.fn()

    const history = [
      { role: 'user', content: 'build a site' },
      { role: 'assistant', content: [{ type: 'tool-call', toolName: 'askQuestion' }] },
    ]

    const result = await runClassification({
      agentConfig: { classifyPrompt, stopAfterTools: ['askQuestion'] },
      prompt: 'yes, blue theme',
      historyMessages: history,
      isInitialPrompt: false,
      appId: 'app1',
    })

    expect(classifyPrompt).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('returns null when classifier returns null', async () => {
    const classifyPrompt = vi.fn().mockResolvedValue(null)

    const result = await runClassification({
      agentConfig: { classifyPrompt },
      prompt: 'hello',
      historyMessages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }],
      isInitialPrompt: false,
    })

    expect(result).toBeNull()
  })

  it('returns null when classifier throws', async () => {
    const classifyPrompt = vi.fn().mockRejectedValue(new Error('API timeout'))

    const result = await runClassification({
      agentConfig: { classifyPrompt },
      prompt: 'build something',
      historyMessages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }],
      isInitialPrompt: false,
    })

    expect(result).toBeNull()
  })

  it('includes attachment info from uploadedFileName', async () => {
    const classifyInitialPrompt = vi.fn().mockResolvedValue({ class: 'complex', reason: 'plan attached' })

    await runClassification({
      agentConfig: { classifyInitialPrompt },
      prompt: 'execute this plan',
      historyMessages: [],
      isInitialPrompt: true,
      appId: 'app1',
      uploadedFileName: 'plan.md',
    })

    expect(classifyInitialPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [{ name: 'plan.md' }],
      }),
    )
  })

  it('falls back gracefully when only classifyPrompt is defined but isInitialPrompt is true', async () => {
    const classifyPrompt = vi.fn().mockResolvedValue({ class: 'complex', reason: 'test' })

    const result = await runClassification({
      agentConfig: { classifyPrompt },
      prompt: 'build a site',
      historyMessages: [],
      isInitialPrompt: true,
    })

    // No classifyInitialPrompt defined, isInitialPrompt true → classifierFn is undefined
    expect(classifyPrompt).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('correctly routes based on isInitialPrompt regardless of history content', async () => {
    const classifyInitialPrompt = vi.fn().mockResolvedValue({ class: 'complex', reason: 'new app' })
    const classifyPrompt = vi.fn()

    // Simulate pre-persisted message: history has the current message but caller
    // computed isInitialPrompt=true via dropTrailingPrompt
    const history = [{ role: 'user', content: 'build me a website' }]

    const result = await runClassification({
      agentConfig: { classifyInitialPrompt, classifyPrompt },
      prompt: 'build me a website',
      historyMessages: history,
      isInitialPrompt: true,
      appId: 'app1',
    })

    expect(classifyInitialPrompt).toHaveBeenCalled()
    expect(classifyPrompt).not.toHaveBeenCalled()
    expect(result!.content).toContain('class="complex"')
  })
})
