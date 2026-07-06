import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LogoJob } from '../logo-job-state.js'

// vi.mock factories hoist above module-level declarations; everything they close
// over must come from vi.hoisted() (see LogoGenerationService.test.ts for the
// same contract).
const {
  mockReadLogoJob,
  mockWriteLogoJob,
  mockRevertSlots,
  mockGetManifest,
  mockGetSlot,
  mockRemoveSlot,
  mockSetSlot,
  mockIsShimmerUrl,
  mockCreateForWorkspace,
  mockFindAll,
  mockIsInFlight,
  mockCancel,
  mockEmitTerminalEvent,
} = vi.hoisted(() => ({
  mockReadLogoJob: vi.fn(),
  mockWriteLogoJob: vi.fn(),
  mockRevertSlots: vi.fn(),
  mockGetManifest: vi.fn(),
  mockGetSlot: vi.fn(),
  mockRemoveSlot: vi.fn(),
  mockSetSlot: vi.fn(),
  mockIsShimmerUrl: vi.fn(),
  mockCreateForWorkspace: vi.fn(),
  mockFindAll: vi.fn(),
  mockIsInFlight: vi.fn(),
  mockCancel: vi.fn(),
  mockEmitTerminalEvent: vi.fn(),
}))

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../logo-job-state.js', () => ({
  readLogoJob: (...a: unknown[]) => mockReadLogoJob(...(a as [])),
  writeLogoJob: (...a: unknown[]) => mockWriteLogoJob(...(a as [])),
}))

vi.mock('../logo-slots.js', () => ({
  revertSlots: (...a: unknown[]) => mockRevertSlots(...(a as [])),
}))

vi.mock('../../MediaManifestService.js', () => ({
  mediaManifestService: {
    getManifest: mockGetManifest,
    getSlot: mockGetSlot,
    removeSlot: mockRemoveSlot,
    setSlot: mockSetSlot,
  },
}))

vi.mock('../logo-shimmer.js', () => ({
  isShimmerUrl: (...a: unknown[]) => mockIsShimmerUrl(...(a as [])),
}))

vi.mock('../../../workspace/index.js', () => ({
  createForWorkspace: mockCreateForWorkspace,
}))

vi.mock('../../../database/repositories/index.js', () => ({
  appRepository: { findAll: mockFindAll },
}))

vi.mock('../LogoGenerationService.js', () => ({
  logoGenerationService: {
    isInFlight: mockIsInFlight,
    cancel: mockCancel,
    emitTerminalEvent: mockEmitTerminalEvent,
  },
}))

import {
  reconcileStaleLogoJob,
  reconcileAllStaleLogoJobs,
  reconcilePendingLogoSlotsForPublish,
} from '../logo-reconciler.js'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'

const fakeFiles = createStubWorkspaceFiles()

const staleJob = (overrides: Partial<LogoJob> = {}): LogoJob => ({
  jobId: 'job-1',
  status: 'generating',
  prompt: 'p',
  layouts: ['horizontal'],
  slots: ['logo/horizontal'],
  isRegeneration: true,
  previousSlots: { 'logo/horizontal': { currentUrl: 'https://cdn/prior.png' } as never },
  attempt: 0,
  createdAt: 'now',
  updatedAt: 'now',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateForWorkspace.mockReturnValue({ files: fakeFiles })
  mockWriteLogoJob.mockResolvedValue(undefined)
  mockRevertSlots.mockResolvedValue(undefined)
  mockIsInFlight.mockReturnValue(false)
  mockCancel.mockResolvedValue({ cancelled: true })
  // Default: the post-reconcile strip pass re-reads a slot that no longer carries a
  // pendingJobId, so it is a no-op unless a test overrides getSlot.
  mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn/real.png' } })
  mockRemoveSlot.mockResolvedValue(undefined)
  mockSetSlot.mockResolvedValue(undefined)
  mockIsShimmerUrl.mockReturnValue(false)
})

describe('reconcileStaleLogoJob', () => {
  it('reverts, marks failed, and emits when a generating job is not in flight', async () => {
    const job = staleJob()
    mockReadLogoJob.mockResolvedValue(job)
    mockIsInFlight.mockReturnValue(false)

    await reconcileStaleLogoJob('app-1')

    expect(mockRevertSlots).toHaveBeenCalledWith('app-1', job)
    expect(mockWriteLogoJob).toHaveBeenCalledWith(
      fakeFiles,
      'app-1',
      expect.objectContaining({ status: 'failed', error: expect.stringContaining('interrupted') }),
    )
    expect(mockEmitTerminalEvent).toHaveBeenCalledWith(
      'app-1',
      expect.objectContaining({ status: 'failed', jobId: 'job-1', errorKind: 'error' }),
    )
  })

  it('reverts a fresh job (empty previousSlots) — revertSlots strips the placeholder', async () => {
    const job = staleJob({ isRegeneration: false, previousSlots: {} })
    mockReadLogoJob.mockResolvedValue(job)

    await reconcileStaleLogoJob('app-1')

    expect(mockRevertSlots).toHaveBeenCalledWith('app-1', job)
    expect(mockWriteLogoJob).toHaveBeenCalledWith(
      fakeFiles, 'app-1', expect.objectContaining({ status: 'failed' }),
    )
  })

  it('leaves an in-flight job alone (no revert, no failed write)', async () => {
    mockReadLogoJob.mockResolvedValue(staleJob())
    mockIsInFlight.mockReturnValue(true)

    await reconcileStaleLogoJob('app-1')

    expect(mockRevertSlots).not.toHaveBeenCalled()
    expect(mockWriteLogoJob).not.toHaveBeenCalled()
    expect(mockEmitTerminalEvent).not.toHaveBeenCalled()
  })

  it('no-ops on a null workspace (PaaS — no app record)', async () => {
    mockCreateForWorkspace.mockReturnValue(null)

    await reconcileStaleLogoJob('paas-app')

    expect(mockReadLogoJob).not.toHaveBeenCalled()
    expect(mockRevertSlots).not.toHaveBeenCalled()
  })

  it('no-ops when there is no job file', async () => {
    mockReadLogoJob.mockResolvedValue(null)

    await reconcileStaleLogoJob('app-1')

    expect(mockRevertSlots).not.toHaveBeenCalled()
    expect(mockWriteLogoJob).not.toHaveBeenCalled()
  })

  it('no-ops on a terminal (completed) job', async () => {
    mockReadLogoJob.mockResolvedValue(staleJob({ status: 'completed' }))

    await reconcileStaleLogoJob('app-1')

    expect(mockRevertSlots).not.toHaveBeenCalled()
  })
})

describe('reconcileAllStaleLogoJobs', () => {
  it('reconciles every app and swallows per-app errors', async () => {
    mockFindAll.mockReturnValue([{ id: 'app-1' }, { id: 'app-2' }, { id: 'app-3' }])
    // app-2 explodes inside the workspace resolve; the pass must continue.
    mockCreateForWorkspace.mockImplementation((id: string) => {
      if (id === 'app-2') throw new Error('workspace boom')
      return { files: fakeFiles }
    })
    mockReadLogoJob.mockResolvedValue(staleJob())

    await reconcileAllStaleLogoJobs()

    // app-1 and app-3 were reconciled despite app-2 throwing.
    expect(mockRevertSlots).toHaveBeenCalledTimes(2)
  })
})

describe('reconcilePendingLogoSlotsForPublish', () => {
  it('cancels with revert when a pending slot is still in flight', async () => {
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'logo/horizontal': { currentUrl: 'shimmer', pendingJobId: 'live-job' } },
    })
    mockIsInFlight.mockReturnValue(true)

    await reconcilePendingLogoSlotsForPublish('app-1')

    expect(mockCancel).toHaveBeenCalledWith('app-1', 'live-job', { revert: true })
  })

  it('reconciles (reverts from snapshot) when a pending slot is orphaned (not in flight)', async () => {
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'logo/horizontal': { currentUrl: 'shimmer', pendingJobId: 'orphan-job' } },
    })
    mockIsInFlight.mockReturnValue(false)
    mockReadLogoJob.mockResolvedValue(staleJob({ jobId: 'orphan-job' }))

    await reconcilePendingLogoSlotsForPublish('app-1')

    expect(mockCancel).not.toHaveBeenCalled()
    expect(mockRevertSlots).toHaveBeenCalled()
  })

  it('does nothing when no slot carries a pendingJobId', async () => {
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'logo/horizontal': { currentUrl: 'https://cdn/real.png' } },
    })

    await reconcilePendingLogoSlotsForPublish('app-1')

    expect(mockCancel).not.toHaveBeenCalled()
    expect(mockRevertSlots).not.toHaveBeenCalled()
  })

  it('is best-effort — a getManifest failure does not throw', async () => {
    mockGetManifest.mockRejectedValue(new Error('manifest boom'))
    await expect(reconcilePendingLogoSlotsForPublish('app-1')).resolves.toBeUndefined()
  })

  it('strips a shimmer placeholder whose marker the job file does not own (orphan mismatch)', async () => {
    // The manifest carries a dangling marker the current (terminal) job file does
    // not own, so reconcileStaleLogoJob no-ops and revert skips it as superseded.
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'logo/horizontal': { currentUrl: 'shimmer.svg', pendingJobId: 'ghost-job' } },
    })
    mockIsInFlight.mockReturnValue(false)
    mockReadLogoJob.mockResolvedValue(staleJob({ jobId: 'other-job', status: 'completed' }))
    // Pass 2 re-reads the slot and finds the marker still present.
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { currentUrl: 'shimmer.svg', pendingJobId: 'ghost-job' },
    })
    mockIsShimmerUrl.mockReturnValue(true)

    await reconcilePendingLogoSlotsForPublish('app-1')

    expect(mockRemoveSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal')
    expect(mockSetSlot).not.toHaveBeenCalled()
  })

  it('drops only the dangling marker (keeps the real logo) when no job file owns it', async () => {
    mockGetManifest.mockResolvedValue({
      success: true,
      manifest: { 'logo/horizontal': { currentUrl: 'https://cdn/real.png', pendingJobId: 'ghost-job' } },
    })
    mockIsInFlight.mockReturnValue(false)
    mockReadLogoJob.mockResolvedValue(null) // no job file at all
    mockGetSlot.mockResolvedValue({
      success: true,
      slot: { mediaType: 'logo', currentUrl: 'https://cdn/real.png', pendingJobId: 'ghost-job' },
    })
    mockIsShimmerUrl.mockReturnValue(false)

    await reconcilePendingLogoSlotsForPublish('app-1')

    expect(mockRemoveSlot).not.toHaveBeenCalled()
    expect(mockSetSlot).toHaveBeenCalledWith(
      'app-1',
      'logo/horizontal',
      expect.not.objectContaining({ pendingJobId: expect.anything() }),
    )
  })
})
