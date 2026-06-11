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
  mockEmitToApp,
  mockSendToApp,
  mockReadLogoJob,
  mockWriteLogoJob,
  mockEnsureShimmer,
  mockSnapshot,
  mockPlaceShimmer,
  mockRevert,
  mockSaveSlots,
  mockReconcileStale,
} = vi.hoisted(() => {
  class FakeBudgetError extends Error {
    static isInstance(e: unknown): e is FakeBudgetError { return e instanceof FakeBudgetError }
  }
  return {
    FakeBudgetError,
    mockGenerate: vi.fn(),
    mockEmitToApp: vi.fn(() => 1),
    mockSendToApp: vi.fn(),
    mockReadLogoJob: vi.fn(),
    mockWriteLogoJob: vi.fn(),
    mockEnsureShimmer: vi.fn(async () => ({
      square: '/airo-assets/uploads/airo-logo-shimmer-square.svg',
      horizontal: '/airo-assets/uploads/airo-logo-shimmer-horizontal.svg',
      vertical: '/airo-assets/uploads/airo-logo-shimmer-vertical.svg',
    })),
    mockSnapshot: vi.fn(async () => ({ previousSlots: {}, isRegeneration: false })),
    mockPlaceShimmer: vi.fn(async () => {}),
    mockRevert: vi.fn(async () => {}),
    mockSaveSlots: vi.fn(async () => ({ savedSlots: { horizontal: '/airo-assets/images/logo/horizontal' }, slotSaveFailed: false, failedLayouts: [], skippedLayouts: [] })),
    mockReconcileStale: vi.fn(async () => {}),
  }
})

vi.mock('@airo/ai-common', () => ({ BudgetExceededError: FakeBudgetError }))

vi.mock('../../LogoService.js', () => ({ logoService: { generate: mockGenerate } }))

vi.mock('../../../server/ai-lib-websocket-server.js', () => ({ emitToApp: mockEmitToApp }))

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
}))

vi.mock('../logo-slots.js', () => ({
  LOGO_SLOT_PATHS: { square: 'logo/primary', horizontal: 'logo/horizontal', vertical: 'logo/vertical' },
  saveLogoToSlots: mockSaveSlots,
  snapshotSlots: mockSnapshot,
  placeShimmerSlots: mockPlaceShimmer,
  revertSlots: mockRevert,
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
  mockEmitToApp.mockReturnValue(1)
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
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ type: 'logo', data: expect.objectContaining({ status: 'completed', jobId: res.jobId }) }))
    expect(mockSendToApp).toHaveBeenCalledWith('app-1', 'logo', expect.objectContaining({ status: 'completed' }))
  })

  it('includes the hosted logo (id + urls) in the completed emit payload', async () => {
    mockGenerate.mockResolvedValue(okResponse)
    const res = await logoGenerationService.start({ ...baseParams, layouts: ['horizontal'] })
    await res.done

    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({
        type: 'logo',
        data: expect.objectContaining({
          status: 'completed',
          logoId: okResponse.logo.id,
          logo: okResponse.logo,
        }),
      }))
    // SSE mirror carries the same payload so non-WS clients render the logo too.
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
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', errorKind: 'budget' }) }))
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
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed', jobId: res.jobId }) }))
  })
})

describe('LogoGenerationService.cancel', () => {
  it('aborts the in-flight job, reverts, and emits cancelled', async () => {
    abortable()
    const res = await logoGenerationService.start(baseParams)
    await Promise.all([logoGenerationService.cancel('app-1', res.jobId), res.done])
    expect(mockRevert).toHaveBeenCalledTimes(1)
    expect(lastJob?.status).toBe('cancelled')
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', jobId: res.jobId }) }))
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
    expect(mockEmitToApp).toHaveBeenCalledWith('app-1', 'message',
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', jobId: res.jobId }) }))
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
