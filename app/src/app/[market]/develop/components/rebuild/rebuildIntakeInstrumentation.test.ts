/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogImpressionEvent = vi.hoisted(() => vi.fn(function impression() { return vi.fn() }))
const mockLogClickEvent = vi.hoisted(() => vi.fn(function click() { return vi.fn() }))

vi.mock('@/utils/instrumentation', () => ({
  logImpressionEvent: mockLogImpressionEvent,
  logClickEvent: mockLogClickEvent,
}))

import {
  trackRebuildIntakeFormShown,
  trackRebuildIntakeSubmitted,
} from './rebuildIntakeInstrumentation'

describe('rebuildIntakeInstrumentation', function rebuildIntakeInstrumentationTests() {
  beforeEach(function resetMocks() {
    vi.clearAllMocks()
  })

  it('logs intake form impression with source URL', function formShown() {
    trackRebuildIntakeFormShown('https://example.com')

    expect(mockLogImpressionEvent).toHaveBeenCalledWith('develop.rebuild.intakeform', {
      sourceUrl: 'https://example.com',
    })
  })

  it('logs explicit submit with scope and design selections', function explicitSubmit() {
    trackRebuildIntakeSubmitted({
      scope: 'small',
      designChoice: 'modernize',
      designDirection: 'modernize',
      submitSource: 'submit',
      sourceUrl: 'https://example.com',
    })

    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.rebuild.intakesubmit', {
      scope: 'small',
      designChoice: 'modernize',
      designDirection: 'modernize',
      submitSource: 'submit',
      sourceUrl: 'https://example.com',
    })
  })

  it('logs defaults path with recommended selections', function defaultsSubmit() {
    trackRebuildIntakeSubmitted({
      scope: 'homepage_only',
      designChoice: 'keep_similar',
      designDirection: 'keep-similar',
      submitSource: 'defaults',
      sourceUrl: 'https://example.com',
    })

    expect(mockLogClickEvent).toHaveBeenCalledWith('develop.rebuild.intakedefaults', {
      scope: 'homepage_only',
      designChoice: 'keep_similar',
      designDirection: 'keep-similar',
      submitSource: 'defaults',
      sourceUrl: 'https://example.com',
    })
  })
})
