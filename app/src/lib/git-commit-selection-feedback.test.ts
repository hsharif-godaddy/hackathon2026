/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyCommitSelectionFailure } from '@/lib/git-commit-selection-feedback'

const mockAddGrowlMessage = vi.fn()

vi.mock('@ux/growl', () => ({
  default: {
    addGrowlMessage: (...args: unknown[]) => mockAddGrowlMessage(...args),
  },
}))

describe('git-commit-selection-feedback', function packageTests() {
  const t = vi.fn((key: string, _values?: Record<string, unknown>, fallback?: string) => fallback ?? key)

  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  describe('#notifyCommitSelectionFailure', function notify() {
    it('shows auth copy when isAuthError is true', function authCopy() {
      notifyCommitSelectionFailure(true, t)

      expect(mockAddGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'git-commit-selection-failed',
          title: 'Sign in required',
          children: 'Your session expired. Sign in again, then retry switching versions.',
          emphasis: 'critical',
        }),
      )
      expect(t).toHaveBeenCalledWith(
        'builder_version_history_switch_auth_error_title',
        undefined,
        'Sign in required',
      )
      expect(t).toHaveBeenCalledWith(
        'builder_version_history_switch_auth_error_description',
        undefined,
        'Your session expired. Sign in again, then retry switching versions.',
      )
    })

    it('shows generic copy when isAuthError is false', function genericCopy() {
      notifyCommitSelectionFailure(false, t)

      expect(mockAddGrowlMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Failed to switch version',
          children: "You can't switch between versions while Airo is actively building.",
        }),
      )
      expect(t).toHaveBeenCalledWith(
        'builder_version_history_switch_error_title',
        undefined,
        'Failed to switch version',
      )
      expect(t).toHaveBeenCalledWith(
        'builder_version_history_switch_error_description',
        undefined,
        "You can't switch between versions while Airo is actively building.",
      )
    })
  })
})
