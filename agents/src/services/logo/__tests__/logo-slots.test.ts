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

import { saveLogoToSlots, snapshotSlots, placeShimmerSlots, revertSlots } from '../logo-slots.js'
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
    // KEEPS the prior hosted currentUrl, NOT the shimmer URL.
    expect(slot.currentUrl).toBe('https://cdn/old-logo.png')
    expect(slot.currentUrl).not.toBe(LOGO_SHIMMER_SLOT_URL)
    // Variant maps + logo source preserved for app-UI overlay rendering.
    expect(slot.solidUrlMap).toEqual(prior.solidUrlMap)
    expect(slot.logoSourceMap).toEqual(prior.logoSourceMap)
    expect(slot.alternatives).toEqual(prior.alternatives)
    expect(slot.pendingJobId).toBe('job-9')
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
    expect(regenSlot.currentUrl).toBe('https://cdn/old.png')
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
            reversed: 'https://cdn/new-reversed.png',
            reversedSolid: 'https://cdn/new-reversed-solid.png',
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
