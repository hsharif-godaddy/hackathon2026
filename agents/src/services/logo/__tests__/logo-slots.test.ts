import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetSlot, mockSetSlot, mockRemoveSlot } = vi.hoisted(() => ({
  mockGetSlot: vi.fn(),
  mockSetSlot: vi.fn(),
  mockRemoveSlot: vi.fn(),
}))
vi.mock('../../MediaManifestService.js', () => ({
  mediaManifestService: { getSlot: mockGetSlot, setSlot: mockSetSlot, removeSlot: mockRemoveSlot },
}))
vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { saveLogoToSlots, saveSingleLogoSlot, snapshotSlots, placeShimmerSlots, revertSlots, classifySurface } from '../logo-slots.js'
import { LOGO_SHIMMER_SLOT_URLS } from '../logo-shimmer.js'
import type { LogoJob } from '../logo-job-state.js'
import type { LogoSessionResponse } from '../../LogoService.js'

// Most assertions only need "some shimmer URL"; the square one stands in.
const LOGO_SHIMMER_SLOT_URL = LOGO_SHIMMER_SLOT_URLS.square

const baseJob = (overrides: Partial<LogoJob> = {}): LogoJob => ({
  jobId: 'job-1', status: 'failed', prompt: 'p', layouts: ['horizontal'],
  slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
  attempt: 0, createdAt: 'now', updatedAt: 'now', ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSetSlot.mockResolvedValue({ success: true })
  mockRemoveSlot.mockResolvedValue({ success: true })
})

describe('snapshotSlots', () => {
  it('snapshots a real prior logo and flags regeneration', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn/logo.png', mediaType: 'logo' } })
    const { previousSlots, isRegeneration } = await snapshotSlots('app-1', ['logo/horizontal'])
    expect(isRegeneration).toBe(true)
    expect(previousSlots['logo/horizontal']).toBeDefined()
  })

  it('ignores a shimmer placeholder (fresh)', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: LOGO_SHIMMER_SLOT_URL, pendingJobId: 'old' } })
    const { previousSlots, isRegeneration } = await snapshotSlots('app-1', ['logo/horizontal'])
    expect(isRegeneration).toBe(false)
    expect(previousSlots).toEqual({})
  })

  it('ignores a missing slot', async () => {
    mockGetSlot.mockResolvedValue({ success: false })
    expect((await snapshotSlots('app-1', ['logo/horizontal'])).isRegeneration).toBe(false)
  })

  it('snapshots a regeneration slot that still holds a real logo under a pendingJobId, stripping the stale pendingJobId', async () => {
    // An in-flight regeneration keeps the prior hosted logo as currentUrl while
    // pendingJobId is set. Superseding it must NOT lose that prior logo (else a
    // later fail/cancel of the new job would delete the user's existing logo).
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { currentUrl: 'https://cdn/prior.png', mediaType: 'logo', pendingJobId: 'old-job' },
    })
    const { previousSlots, isRegeneration } = await snapshotSlots('app-1', ['logo/horizontal'])
    expect(isRegeneration).toBe(true)
    expect(previousSlots['logo/horizontal']).toMatchObject({ currentUrl: 'https://cdn/prior.png' })
    expect(previousSlots['logo/horizontal'].pendingJobId).toBeUndefined()
  })
})

describe('placeShimmerSlots', () => {
  it('sets a fresh slot (no prior) to the shimmer URL with the pendingJobId marker', async () => {
    await placeShimmerSlots(
      'app-1',
      ['logo/primary', 'logo/horizontal'],
      'job-9',
      { 'logo/primary': LOGO_SHIMMER_SLOT_URLS.square, 'logo/horizontal': LOGO_SHIMMER_SLOT_URLS.horizontal },
      {},
    )
    expect(mockSetSlot).toHaveBeenCalledTimes(2)
    const [, slotPath, slot] = mockSetSlot.mock.calls[0]
    expect(slotPath).toBe('logo/primary')
    expect(slot).toMatchObject({ currentUrl: LOGO_SHIMMER_SLOT_URLS.square, pendingJobId: 'job-9', mediaType: 'logo' })
  })

  it('preserves the prior hosted logo for a regeneration slot and only adds the pendingJobId marker', async () => {
    const prior = {
      mediaType: 'logo',
      currentUrl: 'https://cdn/old-logo.png',
      searchQuery: 'old',
      alternatives: ['https://cdn/alt.png'],
      userModified: false,
      solidUrlMap: { 'https://cdn/old-logo.png': 'https://cdn/old-solid.png' },
      logoSourceMap: { 'https://cdn/old-logo.png': { sessionId: 's1', logoId: 'l1' } },
      createdAt: 'earlier',
      lastUpdated: 'earlier',
    }
    await placeShimmerSlots(
      'app-1',
      ['logo/horizontal'],
      'job-9',
      { 'logo/horizontal': LOGO_SHIMMER_SLOT_URLS.horizontal },
      { 'logo/horizontal': prior as never },
    )
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
    const [, slotPath, slot] = mockSetSlot.mock.calls[0]
    expect(slotPath).toBe('logo/horizontal')
    // Always writes shimmer URL so the old logo never flashes during regeneration.
    expect(slot.currentUrl).toBe(LOGO_SHIMMER_SLOT_URLS.horizontal)
    // Variant maps + logo source preserved so saveLogoToSlots can merge them.
    expect(slot.solidUrlMap).toEqual(prior.solidUrlMap)
    expect(slot.logoSourceMap).toEqual(prior.logoSourceMap)
    expect(slot.alternatives).toEqual(prior.alternatives)
    expect(slot.pendingJobId).toBe('job-9')
    expect(slot.createdAt).toBe('earlier')
  })

  it('sets priorUrl from a hosted prior URL (regeneration)', async () => {
    const prior = { mediaType: 'logo', currentUrl: 'https://cdn/old-logo.png', searchQuery: '', alternatives: [], userModified: false, createdAt: 'now', lastUpdated: 'now' }
    await placeShimmerSlots(
      'app-1', ['logo/horizontal'], 'job-9',
      { 'logo/horizontal': LOGO_SHIMMER_SLOT_URLS.horizontal },
      { 'logo/horizontal': prior as never },
    )
    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.priorUrl).toBe('https://cdn/old-logo.png')
  })

  it('omits priorUrl when prior has a local/shimmer currentUrl (fresh gen)', async () => {
    await placeShimmerSlots(
      'app-1', ['logo/horizontal'], 'job-9',
      { 'logo/horizontal': LOGO_SHIMMER_SLOT_URLS.horizontal },
      {},
    )
    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.priorUrl).toBeUndefined()
  })

  it('handles a mix of regeneration and fresh slots in one call', async () => {
    const prior = { mediaType: 'logo', currentUrl: 'https://cdn/old.png', searchQuery: '', alternatives: [], userModified: false, createdAt: 'now', lastUpdated: 'now' }
    await placeShimmerSlots(
      'app-1',
      ['logo/primary', 'logo/horizontal'],
      'job-9',
      { 'logo/primary': LOGO_SHIMMER_SLOT_URLS.square, 'logo/horizontal': LOGO_SHIMMER_SLOT_URLS.horizontal },
      { 'logo/primary': prior as never },
    )
    const [, , regenSlot] = mockSetSlot.mock.calls[0]
    const [, , freshSlot] = mockSetSlot.mock.calls[1]
    // Both paths write shimmer URL (old logo preserved only in previousSlots for revert)
    expect(regenSlot.currentUrl).toBe(LOGO_SHIMMER_SLOT_URLS.square)
    expect(regenSlot.pendingJobId).toBe('job-9')
    expect(freshSlot.currentUrl).toBe(LOGO_SHIMMER_SLOT_URLS.horizontal)
    expect(freshSlot.pendingJobId).toBe('job-9')
  })
})

describe('revertSlots', () => {
  it('restores the prior slot for a regeneration', async () => {
    const prior = { currentUrl: 'https://cdn/old.png', mediaType: 'logo', alternatives: [], userModified: false, searchQuery: '', createdAt: 'now', lastUpdated: 'now' }
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-1', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob({ isRegeneration: true, previousSlots: { 'logo/horizontal': prior as never } }))
    expect(mockSetSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal', prior)
    expect(mockRemoveSlot).not.toHaveBeenCalled()
  })

  it('removes a fresh placeholder when there is no prior slot', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-1', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob())
    expect(mockRemoveSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal')
  })

  it('skips a slot taken over by a newer job', async () => {
    mockGetSlot.mockResolvedValue({ success: true, slot: { pendingJobId: 'job-NEWER', currentUrl: LOGO_SHIMMER_SLOT_URL } })
    await revertSlots('app-1', baseJob())
    expect(mockRemoveSlot).not.toHaveBeenCalled()
    expect(mockSetSlot).not.toHaveBeenCalled()
  })
})

describe('saveLogoToSlots userModified guard', () => {
  const response = (): LogoSessionResponse =>
    ({
      sessionId: 's1',
      logo: {
        id: 'logo-1',
        generatedAt: 'now',
        prompt: 'p',
        modelUsed: 'm',
        urls: {
          horizontal: {
            transparent: 'https://cdn/new-transparent.png',
            solid: 'https://cdn/new-solid.png',
            mockup: 'https://cdn/new-mockup.png',
            landscapeMockup: 'https://cdn/new-landscape.png',
          },
        },
      },
    }) as unknown as LogoSessionResponse

  it('skips a layout when the existing slot is user-modified and not owned by this job', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { mediaType: 'logo', currentUrl: 'https://cdn/user-logo.png', userModified: true },
    })
    const result = await saveLogoToSlots('app-1', response(), 'q', 'owner-job')
    expect(mockSetSlot).not.toHaveBeenCalled()
    expect(result.skippedLayouts).toEqual(['horizontal'])
    expect(result.failedLayouts).toEqual([])
    expect(result.slotSaveFailed).toBe(false)
    expect(result.savedSlots.horizontal).toBeUndefined()
  })

  it('writes when the existing user-modified slot is owned by this job (our own pending regeneration)', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { mediaType: 'logo', currentUrl: 'https://cdn/old.png', userModified: true, pendingJobId: 'owner-job' },
    })
    const result = await saveLogoToSlots('app-1', response(), 'q', 'owner-job')
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
    expect(result.skippedLayouts).toEqual([])
    expect(result.savedSlots.horizontal).toBe('/airo-assets/images/logo/horizontal')
  })

  it('writes a fresh slot (no existing slot) normally', async () => {
    mockGetSlot.mockResolvedValue({ success: false })
    const result = await saveLogoToSlots('app-1', response(), 'q', 'owner-job')
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot).toMatchObject({ currentUrl: 'https://cdn/new-transparent.png', userModified: false })
    expect(result.skippedLayouts).toEqual([])
  })

  it('writes when the existing slot is not user-modified', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { mediaType: 'logo', currentUrl: 'https://cdn/agent-logo.png', userModified: false },
    })
    const result = await saveLogoToSlots('app-1', response(), 'q', 'owner-job')
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
    expect(result.skippedLayouts).toEqual([])
  })
})

describe('saveSingleLogoSlot groupId propagation', () => {
  it('writes groupId to logoSourceMap entry and slot-level logoGroupId', async () => {
    mockGetSlot.mockResolvedValue({ success: false })
    await saveSingleLogoSlot('app-1', 'logo/favicon', 'https://cdn/fav.png', 's1', 'l1', 'job-1', 'favicon', 'group-abc')
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.logoGroupId).toBe('group-abc')
    expect(slot.logoSourceMap['https://cdn/fav.png']).toMatchObject({ sessionId: 's1', logoId: 'l1', groupId: 'group-abc' })
  })

  it('omits logoGroupId from slot when groupId not provided', async () => {
    mockGetSlot.mockResolvedValue({ success: false })
    await saveSingleLogoSlot('app-1', 'logo/favicon', 'https://cdn/fav.png', 's1', 'l1', 'job-1', 'favicon')
    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.logoGroupId).toBeUndefined()
    expect(slot.logoSourceMap['https://cdn/fav.png']).toEqual({ sessionId: 's1', logoId: 'l1' })
  })

  it('merges groupId into existing logoSourceMap entries', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        mediaType: 'logo',
        currentUrl: 'https://cdn/old.png',
        alternatives: [],
        logoSourceMap: { 'https://cdn/old.png': { sessionId: 'old-s', logoId: 'old-l' } },
        userModified: false,
        createdAt: '2026-01-01T00:00:00Z',
        lastUpdated: '2026-01-01T00:00:00Z',
      },
    })
    await saveSingleLogoSlot('app-1', 'logo/primary', 'https://cdn/new.png', 's2', 'l2', 'job-2', 'q', 'group-xyz')
    const [, , slot] = mockSetSlot.mock.calls[0]
    // Old entry preserved, new entry has groupId
    expect(slot.logoSourceMap['https://cdn/old.png']).toEqual({ sessionId: 'old-s', logoId: 'old-l' })
    expect(slot.logoSourceMap['https://cdn/new.png']).toEqual({ sessionId: 's2', logoId: 'l2', groupId: 'group-xyz' })
  })
})

describe('saveLogoToSlots cascade clears sibling logoGroupId', () => {
  const response = (): LogoSessionResponse =>
    ({
      sessionId: 's1',
      logo: {
        id: 'logo-1',
        generatedAt: 'now',
        prompt: 'p',
        modelUsed: 'm',
        urls: {
          horizontal: {
            transparent: 'https://cdn/new.png',
            solid: 'https://cdn/new-solid.png',
            mockup: 'https://cdn/new-mockup.png',
            landscapeMockup: 'https://cdn/new-lm.png',
          },
        },
      },
    }) as unknown as LogoSessionResponse

  it('clears logoGroupId on sibling slots that have logoSourceMap', async () => {
    let callCount = 0
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      // First call: the written slot (horizontal) — fresh, no existing
      if (path === 'logo/horizontal' && callCount === 0) {
        callCount++
        return { success: false }
      }
      // Cascade reads: siblings with group + sourceMap
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            mediaType: 'logo',
            currentUrl: 'https://cdn/sq.png',
            logoGroupId: 'old-group',
            logoSourceMap: { 'https://cdn/sq.png': { sessionId: 's0', logoId: 'l0', groupId: 'old-group' } },
            userModified: false,
          },
        }
      }
      if (path === 'logo/favicon') {
        return {
          success: true,
          slot: {
            mediaType: 'logo',
            currentUrl: 'https://cdn/fav.png',
            logoGroupId: 'old-group',
            logoSourceMap: { 'https://cdn/fav.png': { sessionId: 's0', logoId: 'l0', groupId: 'old-group' } },
            userModified: false,
          },
        }
      }
      return { success: false }
    })

    await saveLogoToSlots('app-1', response(), 'q', 'owner-job')

    // 1 write for horizontal + 2 cascade clears (primary, favicon)
    expect(mockSetSlot).toHaveBeenCalledTimes(3)
    const cascadeCalls = mockSetSlot.mock.calls.slice(1)
    for (const [, , slot] of cascadeCalls) {
      expect(slot.logoGroupId).toBeUndefined()
    }
  })

  it('does not cascade-clear siblings without logoSourceMap', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/horizontal') return { success: false }
      // Sibling with logoGroupId but NO logoSourceMap (user-uploaded, no AI metadata)
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: { mediaType: 'logo', currentUrl: 'https://cdn/uploaded.png', logoGroupId: 'some-group', userModified: true },
        }
      }
      return { success: false }
    })

    await saveLogoToSlots('app-1', response(), 'q', 'owner-job')

    // Only the horizontal write; no cascade write for primarysince it lacks logoSourceMap
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
  })

  it('does not cascade-clear siblings without logoGroupId', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/horizontal') return { success: false }
      // Sibling with logoSourceMap but NO logoGroupId (never linked)
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            mediaType: 'logo',
            currentUrl: 'https://cdn/sq.png',
            logoSourceMap: { 'https://cdn/sq.png': { sessionId: 's0', logoId: 'l0' } },
            userModified: false,
          },
        }
      }
      return { success: false }
    })

    await saveLogoToSlots('app-1', response(), 'q', 'owner-job')

    // Only the horizontal write; no cascade needed
    expect(mockSetSlot).toHaveBeenCalledTimes(1)
  })
})

describe('classifySurface', () => {
  it('classifies white as light', () => {
    expect(classifySurface('#ffffff')).toBe('light')
  })

  it('classifies black as dark', () => {
    expect(classifySurface('#000000')).toBe('dark')
  })

  it('classifies dark brown as dark', () => {
    expect(classifySurface('#2c1810')).toBe('dark')
  })

  it('classifies cream as light', () => {
    expect(classifySurface('#f5f0e8')).toBe('light')
  })

  it('defaults to light on unparseable input and logs a warning', async () => {
    const { logger } = await import('../../../logging/index.js')
    const result: string = classifySurface('not-a-color')
    expect(result).toBe('light')
    expect(logger.warn).toHaveBeenCalledWith(
      'logo.classifySurface.parse_failed',
      expect.objectContaining({ hex: 'not-a-color' }),
    )
  })
})

describe('saveLogoToSlots — surface variant preservation', () => {
  it('preserves existing lightSurfaceUrl when generating for dark surface', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/old.png',
        mediaType: 'logo',
        lightSurfaceUrl: 'https://cdn/light-variant.png',
      },
    })

    const resp: LogoSessionResponse = {
      sessionId: 'sess-1',
      logo: {
        id: 'logo-1',
        urls: { horizontal: { transparent: 'https://cdn/new-dark.png' }, square: undefined, vertical: undefined },
      },
    } as unknown as LogoSessionResponse

    await saveLogoToSlots('app-1', resp, 'query', 'job-1', { background: '#1a1a1a' })

    const setSlotCall = mockSetSlot.mock.calls[0]
    const slotData = setSlotCall[2]
    expect(slotData.lightSurfaceUrl).toBe('https://cdn/light-variant.png')
    expect(slotData.darkSurfaceUrl).toBe('https://cdn/new-dark.png')
    expect(slotData.surfaceMode).toBe('dark')
    expect(slotData.generatedForSurfaceColor).toBe('#1a1a1a')
  })

  it('preserves surfaceMode and generatedForSurfaceColor when colors is undefined', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/old.png',
        mediaType: 'logo',
        surfaceMode: 'dark',
        generatedForSurfaceColor: '#1a1a1a',
        darkSurfaceUrl: 'https://cdn/dark-variant.png',
      },
    })

    const resp: LogoSessionResponse = {
      sessionId: 'sess-1',
      logo: {
        id: 'logo-1',
        urls: { horizontal: { transparent: 'https://cdn/regen.png' }, square: undefined, vertical: undefined },
      },
    } as unknown as LogoSessionResponse

    await saveLogoToSlots('app-1', resp, 'query', 'job-1')

    const setSlotCall = mockSetSlot.mock.calls[0]
    const slotData = setSlotCall[2]
    expect(slotData.surfaceMode).toBe('dark')
    expect(slotData.generatedForSurfaceColor).toBe('#1a1a1a')
    expect(slotData.darkSurfaceUrl).toBe('https://cdn/dark-variant.png')
  })

  it('preserves existing darkSurfaceUrl when generating for light surface', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/old.png',
        mediaType: 'logo',
        darkSurfaceUrl: 'https://cdn/dark-variant.png',
      },
    })

    const resp: LogoSessionResponse = {
      sessionId: 'sess-1',
      logo: {
        id: 'logo-1',
        urls: { horizontal: { transparent: 'https://cdn/new-light.png' }, square: undefined, vertical: undefined },
      },
    } as unknown as LogoSessionResponse

    await saveLogoToSlots('app-1', resp, 'query', 'job-1', { background: '#ffffff' })

    const setSlotCall = mockSetSlot.mock.calls[0]
    const slotData = setSlotCall[2]
    expect(slotData.darkSurfaceUrl).toBe('https://cdn/dark-variant.png')
    expect(slotData.lightSurfaceUrl).toBe('https://cdn/new-light.png')
    expect(slotData.surfaceMode).toBe('light')
  })
})

describe('saveSingleLogoSlot — surface fields', () => {
  it('writes surfaceMode and generatedForSurfaceColor from colors', async () => {
    mockGetSlot.mockResolvedValue({ success: false })

    await saveSingleLogoSlot(
      'app-1', 'logo/favicon', 'https://cdn/fav.png', 's1', 'l1', 'job-1', 'q', undefined,
      { background: '#1a1a1a' },
    )

    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.surfaceMode).toBe('dark')
    expect(slot.generatedForSurfaceColor).toBe('#1a1a1a')
    expect(slot.darkSurfaceUrl).toBe('https://cdn/fav.png')
  })

  it('preserves existing lightSurfaceUrl when generating for dark surface', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/old-fav.png',
        mediaType: 'logo',
        lightSurfaceUrl: 'https://cdn/light-fav.png',
        surfaceMode: 'light',
        generatedForSurfaceColor: '#ffffff',
      },
    })

    await saveSingleLogoSlot(
      'app-1', 'logo/favicon', 'https://cdn/dark-fav.png', 's2', 'l2', 'job-2', 'q', undefined,
      { background: '#000000' },
    )

    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.lightSurfaceUrl).toBe('https://cdn/light-fav.png')
    expect(slot.darkSurfaceUrl).toBe('https://cdn/dark-fav.png')
    expect(slot.surfaceMode).toBe('dark')
    expect(slot.generatedForSurfaceColor).toBe('#000000')
  })

  it('preserves surface metadata when colors is undefined', async () => {
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: {
        currentUrl: 'https://cdn/old-fav.png',
        mediaType: 'logo',
        surfaceMode: 'dark',
        generatedForSurfaceColor: '#222222',
        darkSurfaceUrl: 'https://cdn/dark-fav.png',
      },
    })

    await saveSingleLogoSlot(
      'app-1', 'logo/favicon', 'https://cdn/regen-fav.png', 's3', 'l3', 'job-3', 'q',
    )

    const [, , slot] = mockSetSlot.mock.calls[0]
    expect(slot.surfaceMode).toBe('dark')
    expect(slot.generatedForSurfaceColor).toBe('#222222')
    expect(slot.darkSurfaceUrl).toBe('https://cdn/dark-fav.png')
  })
})
