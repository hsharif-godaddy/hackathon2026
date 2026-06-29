// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  hasCooldown,
  hasShownInSession,
  markCooldown,
  markShownInSession,
} from './task-completion-feedback-storage'

const APP_ID = 'app-1'
const MS_PER_DAY = 24 * 60 * 60 * 1000

describe('task-completion-feedback-storage', function storageTests() {
  beforeEach(function reset() {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('returns false before any cooldown or session mark', function initialState() {
    expect(hasCooldown(APP_ID, 'logoDownload')).toBe(false)
    expect(hasShownInSession(APP_ID, 'logoDownload')).toBe(false)
  })

  it('enforces the 14-day cooldown window', function cooldownWindow() {
    const now = 1_700_000_000_000
    markCooldown(APP_ID, 'logoDownload', now)

    expect(hasCooldown(APP_ID, 'logoDownload', now + (13 * MS_PER_DAY))).toBe(true)
    expect(hasCooldown(APP_ID, 'logoDownload', now + (14 * MS_PER_DAY))).toBe(false)
  })

  it('tracks cooldown independently by milestone', function cooldownByMilestone() {
    const now = 1_700_000_000_000
    markCooldown(APP_ID, 'logoDownload', now)

    expect(hasCooldown(APP_ID, 'logoDownload', now + MS_PER_DAY)).toBe(true)
    expect(hasCooldown(APP_ID, 'websitePublish', now + MS_PER_DAY)).toBe(false)
  })

  it('treats invalid cooldown timestamps as no cooldown', function invalidCooldownTimestamp() {
    window.localStorage.setItem('appbuilder-task-completion-feedback:app-1:logo-download', 'not-a-number')

    expect(hasCooldown(APP_ID, 'logoDownload')).toBe(false)
  })

  it('marks and reads per-session suppression', function sessionSuppression() {
    markShownInSession(APP_ID, 'logoDownload')

    expect(hasShownInSession(APP_ID, 'logoDownload')).toBe(true)
  })

  it('tracks per-session suppression independently by milestone', function sessionByMilestone() {
    markShownInSession(APP_ID, 'logoDownload')

    expect(hasShownInSession(APP_ID, 'logoDownload')).toBe(true)
    expect(hasShownInSession(APP_ID, 'websitePublish')).toBe(false)
  })
})
