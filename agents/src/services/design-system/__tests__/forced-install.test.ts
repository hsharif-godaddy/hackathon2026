import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInstallDesignKitForApp = vi.hoisted(() => vi.fn())
const mockApplyKitDesignTokens = vi.hoisted(() => vi.fn())
const mockMerge = vi.hoisted(() => vi.fn())
const MockAppMetadataRepository = vi.hoisted(() => vi.fn())

vi.mock('../install.js', () => ({
  installDesignKitForApp: mockInstallDesignKitForApp,
}))
vi.mock('../apply-kit-design.js', () => ({
  applyKitDesignTokens: mockApplyKitDesignTokens,
}))
vi.mock('../../../database/repositories/AppMetadataRepository.js', () => ({ AppMetadataRepository: MockAppMetadataRepository }))

const mockLogger = { info: vi.fn(), warn: vi.fn() }

describe('isDesignSystemVariant', () => {
  it('returns true when preflightTools includes listDesignSystems', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ metadata: { preflightTools: ['listDesignSystems', 'other'] } })).toBe(true)
  })

  it('returns false when preflightTools does not include listDesignSystems', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ metadata: { preflightTools: ['other'] } })).toBe(false)
  })

  it('returns false when preflightTools is not an array', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ metadata: { preflightTools: 'listDesignSystems' } })).toBe(false)
  })

  it('returns false when metadata is missing', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({})).toBe(false)
  })

  it('returns false when agentConfig is undefined', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant(undefined)).toBe(false)
  })

  // The -attached fork carries no listDesignSystems preflight tool, so the gate
  // must also recognise it by agent id — otherwise the forced install skips it.
  it('returns true when id starts with initial-design-system even if preflightTools is empty', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ id: 'initial-design-system-homepage-build-attached', metadata: { preflightTools: [] } })).toBe(true)
  })

  it('identifies the base design-system variant via its listDesignSystems preflight tool', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ id: 'initial-design-system-homepage-build', metadata: { preflightTools: ['listDesignSystems'] } })).toBe(true)
  })

  it('returns false for the base design-system id alone (no -attached suffix, no preflight tool)', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    // The id branch is scoped to -attached forks; the base variant must rely on its preflight tool.
    expect(isDesignSystemVariant({ id: 'initial-design-system-homepage-build', metadata: { preflightTools: [] } })).toBe(false)
  })

  it('returns false for a non-design-system id with no listDesignSystems', async () => {
    const { isDesignSystemVariant } = await import('../forced-install.js')
    expect(isDesignSystemVariant({ id: 'develop', metadata: { preflightTools: [] } })).toBe(false)
  })
})

describe('injectForcedDesignKit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockInstallDesignKitForApp.mockResolvedValue({
      slug: 'golden-hour',
      written: 5,
      message: "Installed design system `golden-hour` (5 files extracted to docs/ui-kit/). Call `loadUiKit` next to read the design system primitives and components.",
      displayName: 'Golden Hour',
      design: { palette: { primary: '#c86d42' } },
      questions: [],
    })
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: false, appliedFonts: false })
  })

  it('installs kit and returns synthesized tool_call + tool_result pair', async () => {
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(mockInstallDesignKitForApp).toHaveBeenCalledWith('test-app', 'golden-hour')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ role: 'assistant' })
    expect((result[0]!.content as any[])[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'installDesignSystem',
      input: { slug: 'golden-hour' },
    })
    expect(result[1]).toMatchObject({ role: 'tool' })
    expect((result[1]!.content as any[])[0]).toMatchObject({
      type: 'tool-result',
      toolName: 'installDesignSystem',
    })
    // The call and result must share one toolCallId, or the LLM history is malformed.
    const callId = (result[0]!.content as any[])[0]!.toolCallId
    expect(callId).toBeTruthy()
    expect((result[1]!.content as any[])[0]!.toolCallId).toBe(callId)
    const val: string = (result[1]!.content as any[])[0]!.output.value
    expect(val).toContain('golden-hour')
    expect(val).toContain('loadUiKit')
    expect(mockLogger.info).toHaveBeenCalledWith(
      'design_kit.forced_install',
      expect.objectContaining({ slug: 'golden-hour', appId: 'test-app' }),
    )
  })

  it('deterministically applies the kit design tokens and reflects it in the directive', async () => {
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: true, appliedFonts: true })
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({
      designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger, customerId: 'cust-1',
    })

    // The kit's structured design block + identity are passed straight through.
    expect(mockApplyKitDesignTokens).toHaveBeenCalledWith({
      appId: 'test-app',
      design: { palette: { primary: '#c86d42' } },
      displayName: 'Golden Hour',
      customerId: 'cust-1',
    })
    // The directive must now say the tokens are locked, NOT ask the agent to
    // apply them via colorScheme/fontTheme (those tools are removed).
    const val: string = (result[1]!.content as any[])[0]!.output.value
    expect(val).toMatch(/already applied/i)
    expect(val).toMatch(/do not change them/i)
    expect(val).not.toContain('colorScheme')
    expect(val).not.toContain('fontTheme')
    // Must NOT push the -attached agent to build (that muddies the Phase-1
    // interview turn). It should run setup + hand off; develop builds.
    expect(val).not.toMatch(/build the page/i)
    expect(val).toMatch(/hand off to develop/i)
    expect(val).toMatch(/do NOT edit files/i)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'design_kit.forced_install',
      expect.objectContaining({ appliedColors: true, appliedFonts: true }),
    )
  })

  it('embeds the kit\'s own intake questions in the interview directive', async () => {
    mockInstallDesignKitForApp.mockResolvedValue({
      slug: 'aether', written: 5, message: 'Installed', displayName: 'Aether',
      questions: ['What is your brand voice?', 'How much photography anchors your pages?'],
    })
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'aether', appId: 'test-app', logger: mockLogger })
    const val: string = (result[1]!.content as any[])[0]!.output.value
    expect(val).toContain('What is your brand voice?')
    expect(val).toContain('How much photography anchors your pages?')
    expect(val).toMatch(/kit-specific questions/i)
    expect(val).toMatch(/hand off to develop/i)
  })

  it('falls back to standard Phase-1 questions when the kit ships none', async () => {
    // questions: [] from beforeEach
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })
    const val: string = (result[1]!.content as any[])[0]!.output.value
    expect(val).toMatch(/standard Phase 1/i)
    expect(val).toMatch(/no intake questions/i)
  })

  it('runs loadUiKit and embeds a hard directive when tools are provided', async () => {
    const loadUiKit = { execute: vi.fn().mockResolvedValue('UI KIT PRIMITIVES for golden-hour') }
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({
      designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger,
      tools: { loadUiKit } as any,
    })

    // loadUiKit is run with the kit's appId so its real primitives land in context.
    expect(loadUiKit.execute).toHaveBeenCalledWith({}, { experimental_context: { metadata: { appId: 'test-app' } } })

    // install pair (0,1) + loadUiKit pair (2,3)
    expect(result).toHaveLength(4)
    expect((result[2]!.content as any[])[0]).toMatchObject({ type: 'tool-call', toolName: 'loadUiKit' })
    expect((result[3]!.content as any[])[0]).toMatchObject({ type: 'tool-result', toolName: 'loadUiKit' })

    // The install tool-result carries the directive that stops catalog scoring.
    const val: string = (result[1]!.content as any[])[0]!.output.value
    expect(val).toContain('golden-hour')
    expect(val).toMatch(/do not/i)
    expect(val).toContain('listDesignSystems')
  })

  it('still returns just the install pair (no loadUiKit) when loadUiKit execution fails', async () => {
    const loadUiKit = { execute: vi.fn().mockRejectedValue(new Error('workspace down')) }
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({
      designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger,
      tools: { loadUiKit } as any,
    })

    expect(result).toHaveLength(2)
    expect((result[1]!.content as any[])[0]!.toolName).toBe('installDesignSystem')
  })

  it('returns [] and warns when slug not in catalog', async () => {
    mockInstallDesignKitForApp.mockResolvedValue({ error: 'slug_not_found' })
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'nonexistent', appId: 'test-app', logger: mockLogger })

    expect(result).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'design_kit.forced_install.slug_not_found',
      expect.objectContaining({ slug: 'nonexistent' }),
    )
  })

  it('returns [] and warns when workspace unavailable', async () => {
    mockInstallDesignKitForApp.mockResolvedValue({ error: 'workspace_unavailable' })
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(result).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'design_kit.forced_install.workspace_unavailable',
      expect.any(Object),
    )
  })

  it('returns [] and does not throw when install throws', async () => {
    mockInstallDesignKitForApp.mockRejectedValue(new Error('hash mismatch'))
    const { injectForcedDesignKit } = await import('../forced-install.js')
    const result = await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(result).toHaveLength(0)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'design_kit.forced_install.failed',
      expect.objectContaining({ err: expect.stringContaining('hash mismatch') }),
    )
  })
})

describe('enrichWithForcedDesignKit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockInstallDesignKitForApp.mockResolvedValue({ slug: 'golden-hour', written: 5, message: 'ok', displayName: 'Golden Hour', questions: [] })
  })

  it('logs the request and installs for a design-system variant', async () => {
    const { enrichWithForcedDesignKit } = await import('../forced-install.js')
    const result = await enrichWithForcedDesignKit({
      designKitSlug: 'golden-hour', appId: 'test-app', transport: 'sse', logger: mockLogger,
      agentConfig: { id: 'initial-design-system-homepage-build', tools: {}, metadata: { preflightTools: ['listDesignSystems'] } },
    })

    expect(mockLogger.info).toHaveBeenCalledWith('design_kit.forced_install.requested', expect.objectContaining({ designKitSlug: 'golden-hour', transport: 'sse' }))
    expect(mockInstallDesignKitForApp).toHaveBeenCalledWith('test-app', 'golden-hour')
    expect(result.length).toBeGreaterThan(0)
  })

  it('skips + warns and does not install for a non-variant', async () => {
    const { enrichWithForcedDesignKit } = await import('../forced-install.js')
    const result = await enrichWithForcedDesignKit({
      designKitSlug: 'golden-hour', appId: 'test-app', transport: 'ws', logger: mockLogger,
      agentConfig: { id: 'develop', tools: {}, metadata: { preflightTools: [] } },
    })

    expect(result).toHaveLength(0)
    expect(mockInstallDesignKitForApp).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith('design_kit.forced_install.skipped_non_variant', expect.objectContaining({ transport: 'ws' }))
  })
})

// AIROBUILD-2665 / Fix B — the forced-install path applied the kit's tokens
// DETERMINISTICALLY IN CODE, so it records the designKitTokensLocked marker via
// AppMetadataRepository.merge. This is the only path that sets the marker (the
// wizard applies via the tools themselves and stays unlocked), so the marker is
// scoped to the in-code-apply (gallery/-attached) path. The merge is gated on
// applied.appliedColors || applied.appliedFonts and is best-effort (a throw must
// never block the build).
describe('injectForcedDesignKit — kit-tokens-locked marker (Fix B)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockInstallDesignKitForApp.mockResolvedValue({
      slug: 'golden-hour', written: 5, message: 'ok', displayName: 'Golden Hour',
      design: { palette: { primary: '#c86d42' } }, questions: [],
    })
    MockAppMetadataRepository.mockImplementation(function () {
      return { merge: mockMerge }
    })
    mockMerge.mockReturnValue({ designKitTokensLocked: true })
  })

  it('records the lock marker when colors were applied', async () => {
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: true, appliedFonts: false })
    const { injectForcedDesignKit } = await import('../forced-install.js')

    await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(mockMerge).toHaveBeenCalledWith('test-app', { designKitTokensLocked: true })
  })

  it('records the lock marker when only fonts were applied', async () => {
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: false, appliedFonts: true })
    const { injectForcedDesignKit } = await import('../forced-install.js')

    await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(mockMerge).toHaveBeenCalledWith('test-app', { designKitTokensLocked: true })
  })

  it('does NOT record the lock marker when nothing was applied (wizard-equivalent path stays unlocked)', async () => {
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: false, appliedFonts: false })
    const { injectForcedDesignKit } = await import('../forced-install.js')

    await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    expect(mockMerge).not.toHaveBeenCalled()
  })

  it('is best-effort: a merge throw is swallowed, warns, and the install still returns the synthesized pair', async () => {
    mockApplyKitDesignTokens.mockResolvedValue({ appliedColors: true, appliedFonts: true })
    mockMerge.mockImplementation(() => {
      throw new Error('metadata write failed')
    })
    const { injectForcedDesignKit } = await import('../forced-install.js')

    const result = await injectForcedDesignKit({ designKitSlug: 'golden-hour', appId: 'test-app', logger: mockLogger })

    // The install still succeeds — the synthesized tool_call + tool_result pair is returned.
    expect(result).toHaveLength(2)
    expect((result[1]!.content as any[])[0]!.toolName).toBe('installDesignSystem')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'design_kit.forced_install.lock_marker_failed',
      expect.objectContaining({ appId: 'test-app', slug: 'golden-hour' }),
    )
  })
})
