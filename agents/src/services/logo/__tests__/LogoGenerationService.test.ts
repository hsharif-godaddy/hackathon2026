import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LogoJob } from '../logo-job-state.js'

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// vi.mock factories are hoisted above all module-level declarations, so any
// const/class they close over must come from vi.hoisted() to avoid a TDZ
// ReferenceError. Grouping every mock here keeps the test behavior identical
// to the plan while satisfying the hoisting contract.
const {
  FakeBudgetError,
  mockGenerate,
  mockSendToApp,
  mockReadLogoJob,
  mockWriteLogoJob,
  mockEnsureShimmer,
  mockSnapshot,
  mockPlaceShimmer,
  mockRevert,
  mockSaveSlots,
  mockSaveSingleSlot,
  mockReconcileStale,
  mockManifestGetSlot,
  mockManifestSetSlot,
} = vi.hoisted(() => {
  class FakeBudgetError extends Error {
    static isInstance(e: unknown): e is FakeBudgetError { return e instanceof FakeBudgetError }
  }
  return {
    FakeBudgetError,
    mockGenerate: vi.fn(),
    mockSendToApp: vi.fn(),
    mockReadLogoJob: vi.fn(),
    mockWriteLogoJob: vi.fn(),
    mockEnsureShimmer: vi.fn(async () => ({
      square: '/airo-assets/uploads/airo-logo-shimmer-square.svg',
      horizontal: '/airo-assets/uploads/airo-logo-shimmer-horizontal.svg',
      vertical: '/airo-assets/uploads/airo-logo-shimmer-vertical.svg',
    })),
    mockSnapshot: vi.fn(async () => ({ previousSlots: {}, isRegeneration: false })),
    mockPlaceShimmer: vi.fn(async () => { }),
    mockRevert: vi.fn(async () => { }),
    mockSaveSlots: vi.fn(async () => ({ savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' }, slotSaveFailed: false, failedLayouts: [], skippedLayouts: [] })),
    mockReconcileStale: vi.fn(async () => { }),
    mockSaveSingleSlot: vi.fn(async () => true),
    mockManifestGetSlot: vi.fn(async () => ({ success: false })),
    mockManifestSetSlot: vi.fn(async () => ({ success: true })),
  }
})

vi.mock('@airo/ai-common', () => ({ BudgetExceededError: FakeBudgetError }))

vi.mock('../../LogoService.js', () => ({ logoService: { generateV3: mockGenerate, editV3: mockGenerate, generateVariantV3: mockGenerate } }))

vi.mock('../../../server/sse/registry-singleton.js', () => ({
  getSSERegistry: () => ({ sendToApp: mockSendToApp }),
}))

const fakeWorkspace = {}
vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: () => ({ files: fakeWorkspace }),
}))

let lastJob: LogoJob | null = null
vi.mock('../logo-job-state.js', () => ({
  readLogoJob: (...a: unknown[]) => mockReadLogoJob(...(a as [])),
  writeLogoJob: (...a: unknown[]) => mockWriteLogoJob(...(a as [never, never, never])),
}))

vi.mock('../logo-shimmer.js', () => ({
  ensureShimmerAssets: mockEnsureShimmer,
  ensureShimmerAsset: vi.fn(async () => '/airo-assets/uploads/airo-logo-shimmer-square.svg'),
  LOGO_SHIMMER_SLOT_URLS: {
    square: '/airo-assets/uploads/airo-logo-shimmer-square.svg',
    horizontal: '/airo-assets/uploads/airo-logo-shimmer-horizontal.svg',
    vertical: '/airo-assets/uploads/airo-logo-shimmer-vertical.svg',
  },
}))

vi.mock('../logo-slots.js', () => ({
  LOGO_SLOT_PATHS: { square: 'logo/primary', horizontal: 'logo/horizontal', vertical: 'logo/vertical' },
  FAVICON_SLOT_PATH: 'logo/favicon',
  ALL_LOGO_SLOT_PATHS: ['logo/primary', 'logo/horizontal', 'logo/vertical', 'logo/favicon'],
  saveLogoToSlots: mockSaveSlots,
  saveSingleLogoSlot: mockSaveSingleSlot,
  snapshotSlots: mockSnapshot,
  placeShimmerSlots: mockPlaceShimmer,
  revertSlots: mockRevert,
}))

vi.mock('../../MediaManifestService.js', () => ({
  mediaManifestService: { getSlot: mockManifestGetSlot, setSlot: mockManifestSetSlot },
}))

vi.mock('../logo-reconciler.js', () => ({
  reconcileStaleLogoJob: mockReconcileStale,
}))

import { logoGenerationService } from '../LogoGenerationService.js'

const okResponse = { sessionId: 's', logo: { id: 'l', generatedAt: 'now', prompt: 'p', modelUsed: 'm', urls: { horizontal: {} } } }
const baseParams = { appId: 'app-1', prompt: 'p', layouts: ['horizontal'] as const, customerId: 'c', budgetUserId: 'u', searchQuery: 'q' }
const abortable = () => mockGenerate.mockImplementation(({ signal }: { signal?: AbortSignal }) =>
  new Promise((_res, rej) => signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))))

beforeEach(() => {
  vi.clearAllMocks(); lastJob = null
  mockReadLogoJob.mockImplementation(async () => lastJob)
  mockWriteLogoJob.mockImplementation(async (_ws: unknown, _appId: string, job: LogoJob) => { lastJob = job })
  mockEnsureShimmer.mockResolvedValue({
    square: '/airo-assets/uploads/airo-logo-shimmer-square.svg',
    horizontal: '/airo-assets/uploads/airo-logo-shimmer-horizontal.svg',
    vertical: '/airo-assets/uploads/airo-logo-shimmer-vertical.svg',
  })
  mockPlaceShimmer.mockResolvedValue(undefined)
  mockRevert.mockResolvedValue(undefined)
  mockSnapshot.mockResolvedValue({ previousSlots: {}, isRegeneration: false })
  mockSaveSlots.mockResolvedValue({ savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' }, slotSaveFailed: false, failedLayouts: [], skippedLayouts: [] })
  mockReconcileStale.mockResolvedValue(undefined)
})

describe('LogoGenerationService.start (happy path)', () => {
  it('places shimmer, returns queued, then saves slots + emits completed', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    const res = await logoGenerationService.start({ ...baseParams, layouts: ['horizontal'] })
    expect(res.status).toBe('queued')
    expect(mockPlaceShimmer).toHaveBeenCalledWith(
      'app-1', ['logo/horizontal'], res.jobId,
      { 'logo/horizontal': '/airo-assets/uploads/airo-logo-shimmer-horizontal.svg' },
      {},
    )
    expect(lastJob?.status).toBe('queued')

    await res.done
    expect(mockSaveSlots).toHaveBeenCalledTimes(1)
    // run() threads THIS job's id as the ownerJobId (4th arg) so the save-time
    // userModified guard knows which pending marker it legitimately owns.
    expect(mockSaveSlots).toHaveBeenCalledWith('app-1', okResponse, 'q', res.jobId)
    expect(lastJob?.status).toBe('completed')
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'completed', jobId: res.jobId }))
  })

  it('includes the hosted logo (id + urls) in the completed emit payload', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    const res = await logoGenerationService.start({ ...baseParams, layouts: ['horizontal'] })
    await res.done

    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'completed', logoId: okResponse.logo.id, logo: okResponse.logo }))
  })
})

describe('LogoGenerationService failure handling', () => {
  it('does not retry a budget error; reverts and emits failed', async () => {
    mockGenerate.mockRejectedValue(new FakeBudgetError('budget'))
    const res = await logoGenerationService.start(baseParams)
    await res.done
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('failed')
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'failed', errorKind: 'budget' }))
  })

  it('retries a transient error then succeeds (~1s backoff)', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('network boom')).mockResolvedValueOnce(okResponse)
    const res = await logoGenerationService.start(baseParams)
    await res.done
    expect(mockGenerate).toHaveBeenCalledTimes(2)
    expect(mockSaveSlots).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('completed')
  })
})

describe('LogoGenerationService error-path resilience (no stuck shimmer)', () => {
  it('reverts the placeholder and returns an error when setup (shimmer placement) throws', async () => {
    mockPlaceShimmer.mockRejectedValueOnce(new Error('place boom'))
    const res = await logoGenerationService.start(baseParams)
    expect(res.status).toBe('error')
    expect(res.done).toBeUndefined()
    // The just-placed shimmer is reverted so the slot doesn't stick.
    expect(mockRevert).toHaveBeenCalledTimes(1)
  })

  it('clears the shimmer (revert + failed emit) when the run throws unexpectedly after generate', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    mockSaveSlots.mockRejectedValueOnce(new Error('save boom'))
    const res = await logoGenerationService.start(baseParams)
    const outcome = await res.done
    expect(outcome).toMatchObject({ status: 'failed', jobId: res.jobId })
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('failed')
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'failed', jobId: res.jobId }))
  })
})

describe('LogoGenerationService.cancel', () => {
  it('aborts the in-flight job, reverts, and emits cancelled', async () => {
    abortable()
    const res = await logoGenerationService.start(baseParams)
    await Promise.all([logoGenerationService.cancel('app-1', res.jobId), res.done])
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('cancelled')
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'cancelled', jobId: res.jobId }))
  })

  it('is a no-op when no job is in flight', async () => {
    const out = await logoGenerationService.cancel('app-1', 'nope')
    expect(out.cancelled).toBe(false)
    expect(mockRevert).not.toHaveBeenCalled()
  })

  it('revert:false aborts + emits cancelled but does NOT revert slots', async () => {
    abortable()
    const res = await logoGenerationService.start(baseParams)
    const [out] = await Promise.all([
      logoGenerationService.cancel('app-1', res.jobId, { revert: false }),
      res.done,
    ])
    expect(out.cancelled).toBe(true)
    // Caller (manual slot override) is about to write the slot itself — no revert.
    expect(mockRevert).not.toHaveBeenCalled()
    // Still a terminal cancelled state + emit so the chat clears its in-progress UI.
    expect(lastJob?.status).toBe('cancelled')
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo',
      expect.objectContaining({ status: 'cancelled', jobId: res.jobId }))
  })
})

describe('LogoGenerationService supersede', () => {
  it('drops the superseded job and lets the newer one complete', async () => {
    abortable() // first job hangs until aborted
    const first = await logoGenerationService.start(baseParams)
    mockGenerate.mockResolvedValueOnce(okResponse) // second job succeeds
    const second = await logoGenerationService.start(baseParams)
    await Promise.allSettled([first.done, second.done])

    expect(lastJob?.jobId).toBe(second.jobId)
    expect(lastJob?.status).toBe('completed')
    expect(mockRevert).not.toHaveBeenCalled() // supersede does not revert
    expect(mockSaveSlots).toHaveBeenCalledTimes(1) // only the winner saves
  })
})

describe('LogoGenerationService.isInFlight', () => {
  it('is true while a job hangs and false after it settles', async () => {
    abortable() // generate() hangs until aborted, so the job stays in flight
    const res = await logoGenerationService.start(baseParams)
    expect(logoGenerationService.isInFlight('app-1')).toBe(true)
    expect(logoGenerationService.isInFlight('app-1', res.jobId)).toBe(true)
    // A different jobId does not match the live entry.
    expect(logoGenerationService.isInFlight('app-1', 'some-other-job')).toBe(false)
    // Different app has nothing in flight.
    expect(logoGenerationService.isInFlight('app-2')).toBe(false)

    await Promise.all([logoGenerationService.cancel('app-1', res.jobId), res.done])
    expect(logoGenerationService.isInFlight('app-1')).toBe(false)
    expect(logoGenerationService.isInFlight('app-1', res.jobId)).toBe(false)
  })
})

describe('LogoGenerationService.start restart backstop', () => {
  it('reconciles a stale on-disk job (different id, not in flight) before placing a new shimmer', async () => {
    // Seed .airo/logo.json with a generating job from a prior (dead) worker.
    lastJob = {
      jobId: 'stale-job', status: 'generating', prompt: 'p', layouts: ['horizontal'],
      slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
      attempt: 0, createdAt: 'old', updatedAt: 'old',
    }
    mockGenerate.mockResolvedValue(okResponse)

    const res = await logoGenerationService.start(baseParams)

    // The lazy backstop ran the reconciler for the orphaned job before the new run.
    expect(mockReconcileStale).toHaveBeenCalledWith('app-1')
    expect(res.status).toBe('queued')
    await res.done
  })

  it('does not reconcile when the on-disk job is terminal', async () => {
    lastJob = {
      jobId: 'done-job', status: 'completed', prompt: 'p', layouts: ['horizontal'],
      slots: ['logo/horizontal'], isRegeneration: false, previousSlots: {},
      attempt: 0, createdAt: 'old', updatedAt: 'old',
    }
    mockGenerate.mockResolvedValue(okResponse)

    const res = await logoGenerationService.start(baseParams)
    expect(mockReconcileStale).not.toHaveBeenCalled()
    await res.done
  })

  it('does not reconcile when the on-disk job is still in flight (its own job)', async () => {
    abortable()
    // First start places an in-flight job for app-1.
    const first = await logoGenerationService.start(baseParams)
    mockReconcileStale.mockClear()
    // Second start sees the on-disk generating job — but it IS in flight, so the
    // backstop must not reconcile it (supersede handles it instead).
    mockGenerate.mockResolvedValueOnce(okResponse)
    const second = await logoGenerationService.start(baseParams)
    expect(mockReconcileStale).not.toHaveBeenCalled()
    await Promise.allSettled([first.done, second.done])
  })
})

describe('LogoGenerationService followUpVariants', () => {
  const flushAsync = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
  }

  const variantOkResponse = {
    sessionId: 'vs',
    logo: { id: 'vl', generatedAt: 'now', prompt: 'p', modelUsed: 'm', urls: { square: { transparent: 'https://cdn/fav.png' } } },
  }

  it('chains startVariant after parent completes when followUpVariants present', async () => {
    mockGenerate.mockResolvedValueOnce(okResponse).mockResolvedValue(variantOkResponse)
    mockManifestGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/horizontal') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/horizontal.png',
            logoSourceMap: { 'https://cdn/horizontal.png': { sessionId: 's', logoId: 'l', groupId: 'g1' } },
            logoGroupId: 'g1',
          },
        }
      }
      return { success: false }
    })

    const res = await logoGenerationService.start({ ...baseParams, followUpVariants: ['favicon'] })
    await res.done
    await flushAsync()

    // Parent generate + variant generate = 2 calls
    expect(mockGenerate).toHaveBeenCalledTimes(2)
    // Variant uses saveSingleSlot (not saveSlots)
    expect(mockSaveSingleSlot).toHaveBeenCalledTimes(1)
  })

  it('skips follow-ups when slotSaveFailed is true', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    mockSaveSlots.mockResolvedValueOnce({
      savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' },
      slotSaveFailed: true,
      failedLayouts: ['horizontal'],
      skippedLayouts: [],
    })

    const res = await logoGenerationService.start({ ...baseParams, followUpVariants: ['favicon'] })
    await res.done
    await flushAsync()

    // Only parent generate, no variant
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockSaveSingleSlot).not.toHaveBeenCalled()
  })

  it('skips follow-ups when no source URL can be resolved from saved slots', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    mockManifestGetSlot.mockResolvedValue({ success: false })

    const res = await logoGenerationService.start({ ...baseParams, followUpVariants: ['favicon'] })
    await res.done
    await flushAsync()

    // Only parent generate
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockSaveSingleSlot).not.toHaveBeenCalled()
  })

  it('isolates per-variant errors — one failure does not block subsequent variants', async () => {
    let generateCallCount = 0
    mockGenerate.mockImplementation(async () => {
      generateCallCount++
      // Call 1: parent succeeds with okResponse
      if (generateCallCount === 1) return okResponse
      // Call 2: first variant (square) fails with hard error (no retry)
      if (generateCallCount === 2) throw new FakeBudgetError('budget exceeded')
      // Call 3+: subsequent variants succeed with variant response
      return variantOkResponse
    })
    mockManifestGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/horizontal') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/horizontal.png',
            logoSourceMap: { 'https://cdn/horizontal.png': { sessionId: 's', logoId: 'l', groupId: 'g1' } },
            logoGroupId: 'g1',
          },
        }
      }
      return { success: false }
    })

    const res = await logoGenerationService.start({
      ...baseParams, followUpVariants: ['square', 'favicon'],
    })
    await res.done
    await flushAsync()

    // Parent (1) + variant-square fails hard (2) + variant-favicon succeeds (3)
    expect(mockGenerate).toHaveBeenCalledTimes(3)
    // Only favicon variant saved (square failed during generate)
    expect(mockSaveSingleSlot).toHaveBeenCalledTimes(1)
  })

  it('does not fire follow-ups when parent is cancelled', async () => {
    abortable()

    const res = await logoGenerationService.start({ ...baseParams, followUpVariants: ['favicon'] })
    await Promise.all([logoGenerationService.cancel('app-1', res.jobId), res.done])
    await flushAsync()

    // Parent was cancelled — followUpVariants check is never reached
    expect(mockSaveSingleSlot).not.toHaveBeenCalled()
    expect(mockSaveSlots).not.toHaveBeenCalled()
  })

  it('aborts follow-up chain when a user job registers between variants', async () => {
    let generateCallCount = 0
    mockGenerate.mockImplementation(async ({ signal }: { signal?: AbortSignal }) => {
      generateCallCount++
      if (generateCallCount === 1) return okResponse
      if (generateCallCount === 2) {
        // First variant (square): block until the abort signal fires.
        // A user job starting for the same app will supersede this variant.
        return new Promise((resolve, reject) => {
          if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return }
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          // If never aborted, hang forever (test would time out — signals the test is wrong)
        })
      }
      // Call 3: user job's generate
      return okResponse
    })
    mockManifestGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/horizontal') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/horizontal.png',
            logoSourceMap: { 'https://cdn/horizontal.png': { sessionId: 's', logoId: 'l', groupId: 'g1' } },
            logoGroupId: 'g1',
          },
        }
      }
      return { success: false }
    })

    const res = await logoGenerationService.start({
      ...baseParams, followUpVariants: ['square', 'favicon'],
    })
    await res.done
    await flushAsync()

    // Variant 'square' is now in-flight, paused in generate (waiting on abort).
    // Start a user job — it supersedes the variant (aborts it) and registers in inFlight.
    const userRes = await logoGenerationService.start({ ...baseParams, layouts: ['horizontal'] })
    await flushAsync()

    // Chain should have detected the user job in inFlight and bailed before favicon.
    // Calls: parent (1) + square variant aborted (2) + user job (3). No favicon (4).
    expect(generateCallCount).toBe(3)
    // saveSingleSlot is only called for successful follow-up variants — none completed.
    expect(mockSaveSingleSlot).not.toHaveBeenCalled()

    await userRes.done
  })
})

describe('LogoGenerationService.startVariant groupId', () => {
  const variantResponse = {
    sessionId: 'vs',
    logo: { id: 'vl', generatedAt: 'now', prompt: 'p', modelUsed: 'm', urls: { square: { transparent: 'https://cdn/fav.png' } } },
  }
  const variantParams = {
    appId: 'app-1', variant: 'favicon' as const, sourceUrl: 'https://cdn/source.png',
    customerId: 'c', budgetUserId: 'u',
  }

  it('inherits logoGroupId from source slot when it already has one', async () => {
    mockGenerate.mockResolvedValue(variantResponse)
    mockManifestGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/source.png',
            logoGroupId: 'existing-group',
            logoSourceMap: { 'https://cdn/source.png': { sessionId: 's1', logoId: 'l1', groupId: 'existing-group' } },
          },
        }
      }
      return { success: false }
    })

    const res = await logoGenerationService.startVariant(variantParams)
    await res.done

    expect(mockSaveSingleSlot).toHaveBeenCalledTimes(1)
    const groupArg: string = mockSaveSingleSlot.mock.calls[0][7]
    expect(groupArg).toBe('existing-group')
    // Should NOT back-annotate (source already has group)
    expect(mockManifestSetSlot).not.toHaveBeenCalled()
  })

  it('creates a new groupId and back-annotates source when source has no groupId', async () => {
    mockGenerate.mockResolvedValue(variantResponse)
    mockManifestGetSlot.mockImplementation(async (_appId: string, path: string) => {
      if (path === 'logo/primary') {
        return {
          success: true,
          slot: {
            currentUrl: 'https://cdn/source.png',
            logoSourceMap: { 'https://cdn/source.png': { sessionId: 's1', logoId: 'l1' } },
          },
        }
      }
      return { success: false }
    })

    const res = await logoGenerationService.startVariant(variantParams)
    await res.done

    // Should back-annotate source
    expect(mockManifestSetSlot).toHaveBeenCalledTimes(1)
    const [, path, slot] = mockManifestSetSlot.mock.calls[0]
    expect(path).toBe('logo/primary')
    expect(slot.logoGroupId).toEqual(expect.any(String))
    expect(slot.logoSourceMap['https://cdn/source.png'].groupId).toBe(slot.logoGroupId)

    // Should pass the new groupId to saveSingleLogoSlot
    const groupArg: string = mockSaveSingleSlot.mock.calls[0][7]
    expect(groupArg).toBe(slot.logoGroupId)
  })

  it('uses fallback UUID when source URL is not found in any slot', async () => {
    mockGenerate.mockResolvedValue(variantResponse)
    mockManifestGetSlot.mockResolvedValue({ success: false })

    const res = await logoGenerationService.startVariant(variantParams)
    await res.done

    expect(mockSaveSingleSlot).toHaveBeenCalledTimes(1)
    const groupArg: string = mockSaveSingleSlot.mock.calls[0][7]
    // Falls back to jobId as the groupId
    expect(groupArg).toBe(res.jobId)
  })
})
