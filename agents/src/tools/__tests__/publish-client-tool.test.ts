/**
 * Unit tests for `executePublish` — specifically the seam that maps the
 * browser's client-action envelope onto the agent-facing `PublishResult`.
 *
 * The browser wraps any normal executor return as `{ success: true, result }`,
 * so a declined approval arrives as a SUCCESS carrying `result.cancelled`, not
 * an error. This test locks down the PR's core contract: that envelope is
 * unwrapped to `{ success: false, cancelled: true }` so the agent reports
 * "not published" (no commit) and does not retry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../logging/index.js', () => {
  const instance = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => instance,
  }
  return {
    logger: instance,
    Logger: { create: () => instance },
  }
})

import { executePublish } from '../publish-client-tool.js'
import type { IClientActionService } from '../../services/ClientActionService.js'

function makeService(
  executeAction: IClientActionService['executeAction']
): IClientActionService {
  return {
    executeAction,
    resetTimeout: vi.fn(() => true),
    getPendingRequestIds: vi.fn(() => []),
    cleanup: vi.fn(),
  }
}

describe('executePublish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps a declined approval (success envelope with result.cancelled) to a clean non-error cancellation', async () => {
    // The browser declined the approval and returned `{ cancelled: true }`,
    // which the client wraps as a successful client action.
    const service = makeService(
      vi.fn().mockResolvedValue({ success: true, result: { cancelled: true } })
    )

    const result = await executePublish({ appId: 'app-123' }, service)

    // The seam under test: success envelope + result.cancelled -> not an error,
    // but an explicit cancellation with no commit. The agent must not retry.
    expect(result).toEqual({
      success: false,
      cancelled: true,
      error: 'Publish was not approved by the user.',
    })
    expect(result.commitHash).toBeUndefined()
  })

  it('unwraps a normal success envelope into publish data when not cancelled', async () => {
    const service = makeService(
      vi.fn().mockResolvedValue({
        success: true,
        result: {
          commitHash: 'deadbeefcafe',
          archivePath: '/tmp/archive.tar.gz',
          deploymentId: 'dep-1',
          deploymentStatus: 'DEPLOYED',
        },
      })
    )

    const result = await executePublish({ appId: 'app-123' }, service)

    expect(result).toEqual({
      success: true,
      commitHash: 'deadbeefcafe',
      archivePath: '/tmp/archive.tar.gz',
      deploymentId: 'dep-1',
      deploymentStatus: 'DEPLOYED',
    })
    expect(result.cancelled).toBeUndefined()
  })

  it('passes through a failed client action as a publish error (not a cancellation)', async () => {
    const service = makeService(
      vi.fn().mockResolvedValue({
        success: false,
        error: 'boom',
        requiresUpgrade: true,
        exitCode: 1,
      })
    )

    const result = await executePublish({ appId: 'app-123' }, service)

    expect(result.success).toBe(false)
    expect(result.error).toBe('boom')
    expect(result.requiresUpgrade).toBe(true)
    expect(result.exitCode).toBe(1)
    // A failure is distinct from a decline: no cancelled flag.
    expect(result.cancelled).toBeUndefined()
  })
})
