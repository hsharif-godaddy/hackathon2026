/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'

import type { TipsVariantPackage } from '@/experiments/building-tips-variant/variant-packages'
import { logger } from '@/lib/request-context'
import { renderWithProviders } from '@/tests/test-utils'
import Tips, { CARD_DWELL_MS } from './Tips'
import { tips } from './tips-content'

let mockReduceMotion = false
let mockVariantPackage: TipsVariantPackage = {
  tipIds: tips,
  tipCopyDefaults: {},
  buildingAppMessageKey: 'builder_preview_building_app',
  buildingAppDefaultMessage: 'Building your App',
  loadingAppMessageKey: 'builder_preview_loading_app',
  loadingAppDefaultMessage: 'Loading your App',
}

vi.mock('@/lib/request-context', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/experiments/building-tips-variant/useBuildingTipsVariant', () => ({
  useBuildingTipsVariant: () => mockVariantPackage,
}))

const { mockLogAnalytics } = vi.hoisted(() => ({ mockLogAnalytics: vi.fn() }))
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'on', logAnalytics: mockLogAnalytics }),
}))

let mockIsMdBreakpoint = true
let mockShuffleStrategy: 'identity' | 'reverse' = 'identity'

const { frontCardAnimationCallback } = vi.hoisted(() => ({
  frontCardAnimationCallback: { current: null as (() => void) | null },
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () =>
        function MotionComponent({ children, onAnimationComplete, ...rest }: any) {
          delete rest.animate
          delete rest.variants
          delete rest.transition
          delete rest.initial
          if (onAnimationComplete) {
            frontCardAnimationCallback.current = onAnimationComplete
          }
          return <div {...rest}>{children}</div>
        },
    },
  ),
  useReducedMotion: () => mockReduceMotion,
}))

vi.mock('@airo-ux/loader', () => ({
  Loader: ({ title, description }: any) => (
    <div data-testid="loader">
      <div data-testid="loader-title">{title}</div>
      {description ? <div data-testid="loader-description">{description}</div> : null}
    </div>
  ),
}))

vi.mock('@ux/box', () => ({
  default: ({ children, className }: any) => (
    <div data-testid="box" className={className}>
      {children}
    </div>
  ),
}))

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({
    isBelowSmBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: mockIsMdBreakpoint,
    isLgBreakpoint: true,
    isXlBreakpoint: true,
  }),
}))

vi.mock('@/app/[market]/develop/components/tips/tips-content', async () => {
  const actual = await vi.importActual<typeof import('./tips-content')>(
    '@/app/[market]/develop/components/tips/tips-content',
  )
  return {
    ...actual,
    shuffleArray: <T,>(array: T[]): T[] =>
      mockShuffleStrategy === 'reverse' ? [...array].reverse() : [...array],
  }
})

describe('Tips', () => {
  beforeEach(() => {
    mockReduceMotion = false
    mockIsMdBreakpoint = true
    mockShuffleStrategy = 'identity'
    mockVariantPackage = {
      tipIds: tips,
      tipCopyDefaults: {},
      buildingAppMessageKey: 'builder_preview_building_app',
      buildingAppDefaultMessage: 'Building your App',
      loadingAppMessageKey: 'builder_preview_loading_app',
      loadingAppDefaultMessage: 'Loading your App',
    }
    frontCardAnimationCallback.current = null
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the default tips loader title when no buildingMessage is provided', () => {
    renderWithProviders(<Tips />)

    expect(screen.getByTestId('loader-title')).toHaveTextContent('builder_tips_message')
  })

  it('renders the buildingMessage verbatim with no animated ellipsis', () => {
    renderWithProviders(<Tips buildingMessage="Resuming" />)

    const title = screen.getByTestId('loader-title')
    expect(title.textContent).toBe('Resuming')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(title.textContent).toBe('Resuming')
  })

  it('preserves literal dots in the buildingMessage', () => {
    renderWithProviders(<Tips buildingMessage="Building your project... give me a minute" />)

    expect(screen.getByTestId('loader-title')).toHaveTextContent('Building your project... give me a minute')
  })

  it('renders the buildingDescription when provided', () => {
    renderWithProviders(
      <Tips buildingMessage="Loading" buildingDescription="Please wait" />,
    )

    expect(screen.getByTestId('loader-description')).toHaveTextContent('Please wait')
  })

  it('renders the time-estimate pill with interpolated minutes when timeEstimateMinutes is provided', () => {
    renderWithProviders(<Tips buildingMessage="Building" timeEstimateMinutes={5} />)

    const pill = screen.getByTestId('build-time-estimate')
    expect(pill).toHaveTextContent('On average ~5 minutes')
  })

  it('does not render the time-estimate pill when timeEstimateMinutes is omitted', () => {
    renderWithProviders(<Tips buildingMessage="Building" />)

    expect(screen.queryByTestId('build-time-estimate')).not.toBeInTheDocument()
  })

  it('does not render the time-estimate pill when timeEstimateMinutes is null', () => {
    renderWithProviders(<Tips buildingMessage="Building" timeEstimateMinutes={null} />)

    expect(screen.queryByTestId('build-time-estimate')).not.toBeInTheDocument()
  })

  it('calls onTimeEstimateShown once when the pill renders', () => {
    const onTimeEstimateShown = vi.fn()
    renderWithProviders(
      <Tips buildingMessage="Building" timeEstimateMinutes={5} onTimeEstimateShown={onTimeEstimateShown} />,
    )

    expect(onTimeEstimateShown).toHaveBeenCalledTimes(1)
  })

  it('does not call onTimeEstimateShown when the pill is not rendered', () => {
    const onTimeEstimateShown = vi.fn()
    renderWithProviders(
      <Tips buildingMessage="Building" onTimeEstimateShown={onTimeEstimateShown} />,
    )

    expect(onTimeEstimateShown).not.toHaveBeenCalled()
  })

  it('renders four tip shells; lazy copy only on the front at rest (md+)', () => {
    renderWithProviders(<Tips />)

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBe(4)
    expect(screen.getAllByText(`builder_tips_${tips[0]}_title`).length).toBeGreaterThanOrEqual(1)
    expect(within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`)).toBeInTheDocument()
    expect(screen.queryByText(`builder_tips_${tips[1]}_title`)).not.toBeInTheDocument()
    expect(screen.queryByText(`builder_tips_${tips[2]}_title`)).not.toBeInTheDocument()
    expect(screen.queryByText(`builder_tips_${tips[3]}_title`)).not.toBeInTheDocument()
  })

  it('rotates the front card to tips[1] after the exit animation completes', () => {
    renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })

    act(() => {
      frontCardAnimationCallback.current?.()
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
    ).toBeInTheDocument()
  })

  it('does not register an exit-animation callback before the dwell timeout fires', () => {
    renderWithProviders(<Tips />)

    expect(frontCardAnimationCallback.current).toBeNull()

    const cards = screen.getAllByTestId('tip-card')
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`),
    ).toBeInTheDocument()
  })

  it('continues rotating to tips[2] on the next cycle (scheduleNextRotation re-arms inside complete)', () => {
    renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    act(() => {
      frontCardAnimationCallback.current?.()
    })

    // Reset the captured callback so the second cycle's assertion proves the
    // re-render after setExitingTip re-attached onAnimationComplete (i.e. the
    // `index === 0 && exitingTip !== null` JSX gate fired again).
    frontCardAnimationCallback.current = null

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    expect(frontCardAnimationCallback.current).not.toBeNull()
    act(() => {
      frontCardAnimationCallback.current?.()
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[2]}_title`),
    ).toBeInTheDocument()
  })

  // Rotation must read from the per-mount `orderedTips` state, not the module-level
  // `tips` constant. Reversing shuffleArray makes the two distinguishable so a
  // regression that conflates them surfaces here.
  it('rotates from the shuffled order, not the module-level tips constant', () => {
    mockShuffleStrategy = 'reverse'
    const reversedTips = [...tips].reverse()
    renderWithProviders(<Tips />)

    const initialCards = screen.getAllByTestId('tip-card')
    expect(
      within(initialCards[0] as HTMLElement).getByText(
        `builder_tips_${reversedTips[0]}_title`,
      ),
    ).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    act(() => {
      frontCardAnimationCallback.current?.()
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(
      within(cards[0] as HTMLElement).getByText(
        `builder_tips_${reversedTips[1]}_title`,
      ),
    ).toBeInTheDocument()
  })

  it('force-completes rotation via the watchdog when Framer Motion never fires onAnimationComplete', () => {
    renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    // Deliberately do NOT invoke frontCardAnimationCallback.current.
    // Watchdog window is ANIMATED_CARD_TRANSITION.duration (0.75) * 1000 * 2 + 200 = 1700ms.
    act(() => {
      vi.advanceTimersByTime(1700)
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
    ).toBeInTheDocument()
  })

  it('continues rotating to tips[2] across two consecutive watchdog-driven cycles (complete() re-arms scheduleNextRotation in the watchdog path)', () => {
    renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    act(() => {
      vi.advanceTimersByTime(1700)
    })

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    act(() => {
      vi.advanceTimersByTime(1700)
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBeGreaterThan(0)
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[2]}_title`),
    ).toBeInTheDocument()
  })

  // The only synchronous throw site inside complete()'s try is
  // `scheduleNextRotation()` -> `setTimeout()`. setOrderedTips/setExitingTip
  // are React setters that only queue updates (their updaters run during the
  // next render, outside this try/catch). Wrapping setTimeout to throw on the
  // 2nd CARD_DWELL_MS call (the rearm inside complete()) is the cleanest way
  // to exercise the catch branch — the 1st call is the initial mount's
  // scheduleNextRotation, the 3rd is the catch's own rearm and must succeed.
  // Watchdog setTimeouts use 1700ms / 0ms delays and are not counted.
  it('logs tips.rotation.complete-failed and re-arms rotation when complete() throws (catch branch)', () => {
    const fakeSetTimeout = globalThis.setTimeout
    let dwellSetTimeoutCount = 0
    globalThis.setTimeout = ((handler: any, ms?: number, ...rest: any[]) => {
      if (ms === CARD_DWELL_MS) {
        dwellSetTimeoutCount++
        if (dwellSetTimeoutCount === 2) {
          throw new Error('rearm blocked')
        }
      }
      return fakeSetTimeout(handler, ms, ...rest)
    }) as typeof globalThis.setTimeout

    try {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      act(() => {
        frontCardAnimationCallback.current?.()
      })

      expect(logger.error).toHaveBeenCalledWith(
        'tips.rotation.complete-failed',
        undefined,
        {
          error: expect.objectContaining({ message: 'rearm blocked' }),
        },
      )

      frontCardAnimationCallback.current = null
      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      expect(frontCardAnimationCallback.current).not.toBeNull()
      act(() => {
        frontCardAnimationCallback.current?.()
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBeGreaterThan(0)
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[2]}_title`),
      ).toBeInTheDocument()
    } finally {
      globalThis.setTimeout = fakeSetTimeout
    }
  })

  it('announces the current front tip title via a polite live region', () => {
    const { container } = renderWithProviders(<Tips />)

    const liveRegion = container.querySelector('[role="status"][aria-live="polite"]')
    expect(liveRegion).toBeInTheDocument()
    expect(liveRegion).toHaveTextContent(`builder_tips_${tips[0]}_title`)
  })

  it('updates the polite live region after a rotation completes', () => {
    const { container } = renderWithProviders(<Tips />)
    const liveRegion = container.querySelector('[role="status"][aria-live="polite"]')
    expect(liveRegion).toHaveTextContent(`builder_tips_${tips[0]}_title`)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })
    act(() => {
      frontCardAnimationCallback.current?.()
    })

    expect(liveRegion).toHaveTextContent(`builder_tips_${tips[1]}_title`)
  })

  it('hides the ghost spacer from assistive technology via aria-hidden', () => {
    const { container } = renderWithProviders(<Tips />)

    const ariaHiddenNodes = container.querySelectorAll('[aria-hidden="true"]')
    expect(ariaHiddenNodes.length).toBeGreaterThan(0)

    const spacer = Array.from(ariaHiddenNodes).find((node) =>
      node.getAttribute('class')?.includes('opacity-0'),
    )
    expect(spacer).toBeDefined()
    expect(
      within(spacer as HTMLElement).getByText(`builder_tips_${tips[0]}_title`),
    ).toBeInTheDocument()
  })

  it('sizes the ghost spacer to the incoming tip during the exit transition', () => {
    const { container } = renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })

    const spacer = Array.from(
      container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
    ).find((node) => node.getAttribute('class')?.includes('opacity-0'))
    expect(spacer).toBeDefined()
    expect(
      within(spacer as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
    ).toBeInTheDocument()
  })

  it('mounts next-up tip copy on slot 1 when exit starts, before animation complete', () => {
    renderWithProviders(<Tips />)

    act(() => {
      vi.advanceTimersByTime(CARD_DWELL_MS)
    })

    const cards = screen.getAllByTestId('tip-card')
    expect(cards.length).toBe(4)
    expect(
      within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`),
    ).toBeInTheDocument()
    expect(
      within(cards[1] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
    ).toBeInTheDocument()
  })

  it('sets aria-hidden on lazy empty shells at rest', () => {
    renderWithProviders(<Tips />)

    const cards = screen.getAllByTestId('tip-card')
    expect(cards[0]?.getAttribute('aria-hidden')).not.toBe('true')
    expect(cards[1]?.getAttribute('aria-hidden')).toBe('true')
    expect(cards[2]?.getAttribute('aria-hidden')).toBe('true')
    expect(cards[3]?.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not omit the tips container when rendered (no mounted gate)', () => {
    const { container } = renderWithProviders(<Tips />)

    expect(container.querySelector('.relative')).toBeInTheDocument()
  })

  describe('with prefers-reduced-motion', () => {
    beforeEach(() => {
      mockReduceMotion = true
    })

    it('does not cycle the ellipsis on the loader title', () => {
      renderWithProviders(<Tips buildingMessage="Resuming" />)

      const title = screen.getByTestId('loader-title')
      expect(title.textContent).toBe('Resuming')

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(title.textContent).toBe('Resuming')
    })

    it('watchdog-driven: still rotates when prefers-reduced-motion is set', () => {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      // `vi.advanceTimersByTime(CARD_DWELL_MS)` flushes the rotation timer and,
      // because the reduced-motion watchdog window is 0ms, drains the watchdog in
      // the same call — `exitingTipRef` is already null by the time we reach the
      // line below. The assertion is a defensive smoke check that the FM mock
      // captured the callback at all; the trailing invocation is a documented
      // safe no-op (the early-return invariant in `onFrontStackAnimationComplete`)
      // and confirms calling it post-watchdog cannot double-rotate. The watchdog
      // path itself is covered explicitly by the next test.
      expect(frontCardAnimationCallback.current).not.toBeNull()
      act(() => {
        frontCardAnimationCallback.current?.()
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBeGreaterThan(0)
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
      ).toBeInTheDocument()
      // No-double-rotation contract: the trailing FM-callback invocation
      // must not advance past tips[1] to tips[2] — the early-return in
      // `onFrontStackAnimationComplete` (after exitingTipRef has been
      // cleared by the watchdog) is what guarantees this.
      expect(
        within(cards[0] as HTMLElement).queryByText(`builder_tips_${tips[2]}_title`),
      ).not.toBeInTheDocument()
    })

    it('force-completes rotation via the 0ms watchdog without invoking the FM callback', () => {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      // Reduced-motion watchdog window is 0ms. Advance 1ms to flush the queued timer.
      act(() => {
        vi.advanceTimersByTime(1)
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBeGreaterThan(0)
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
      ).toBeInTheDocument()
    })

    it('does not add height transition ease on tip shells when a fixed stack height applies', () => {
      const gbr = HTMLElement.prototype.getBoundingClientRect
      HTMLElement.prototype.getBoundingClientRect = function stubHeight(this: HTMLElement) {
        const base = gbr.call(this)
        return { ...base, height: 96 } as DOMRect
      }
      try {
        renderWithProviders(<Tips />)
        act(() => {})

        const cards = screen.getAllByTestId('tip-card')
        expect(cards.length).toBe(4)
        for (const card of cards) {
          expect(card.className).not.toMatch(/transition-\[height\]/)
        }
      } finally {
        HTMLElement.prototype.getBoundingClientRect = gbr
      }
    })
  })

  describe('below md breakpoint', () => {
    beforeEach(() => {
      mockIsMdBreakpoint = false
    })

    // NOTE: the framer-motion mock strips `animate`/`variants`/`transition`, so
    // horizontal strip positions (translateX) are not asserted from the DOM.
    it('shows only the front tip copy; back shells are aria-hidden at rest', () => {
      renderWithProviders(<Tips />)

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBe(4)
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`),
      ).toBeInTheDocument()
      expect(screen.queryByText(`builder_tips_${tips[1]}_title`)).not.toBeInTheDocument()
      expect(screen.queryByText(`builder_tips_${tips[2]}_title`)).not.toBeInTheDocument()
      expect(screen.queryByText(`builder_tips_${tips[3]}_title`)).not.toBeInTheDocument()

      expect(cards[0]?.getAttribute('aria-hidden')).not.toBe('true')
      expect(cards[1]?.getAttribute('aria-hidden')).toBe('true')
      expect(cards[2]?.getAttribute('aria-hidden')).toBe('true')
      expect(cards[3]?.getAttribute('aria-hidden')).toBe('true')
    })

    it('mounts slot-1 copy when exit starts, before animation completes', () => {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`),
      ).toBeInTheDocument()
      expect(
        within(cards[1] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
      ).toBeInTheDocument()
    })

    it('advances the front to tips[1] after the exit animation completes', () => {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      act(() => {
        frontCardAnimationCallback.current?.()
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
      ).toBeInTheDocument()
    })

    it('watchdog completes rotation when the exit callback never fires', () => {
      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      act(() => {
        vi.advanceTimersByTime(1700)
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(
        within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[1]}_title`),
      ).toBeInTheDocument()
    })
  })

  it('warns when ResizeObserver is unavailable and still mounts the stack', () => {
    const RO = window.ResizeObserver
    Reflect.deleteProperty(window, 'ResizeObserver')
    try {
      renderWithProviders(<Tips />)
      expect(logger.warn).toHaveBeenCalledWith(
        'tips.resize-observer.unavailable',
        expect.anything(),
      )
      expect(screen.getAllByTestId('tip-card').length).toBe(4)
    } finally {
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: RO,
      })
    }
  })

  describe('with showTips=false', () => {
    it('does not render tip cards', () => {
      renderWithProviders(<Tips buildingMessage="Loading" showTips={false} />)

      expect(
        screen.queryByText(`builder_tips_${tips[0]}_title`),
      ).not.toBeInTheDocument()
    })
  })

  describe('building-tips-variant experiment', () => {
    it('renders Variant A tip cards (control) when the default package is active', () => {
      renderWithProviders(<Tips />)

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBe(4)
      expect(within(cards[0] as HTMLElement).getByText(`builder_tips_${tips[0]}_title`)).toBeInTheDocument()
    })

    const treatmentTipIds = ['start_big_picture_v2', 'get_into_details', 'show_examples_v2', 'ask_one_change']
    const treatmentTipCopyDefaults = {
      start_big_picture_v2: {
        title: 'Start with the big picture',
        description: 'I’ll build the first version of your project based on what you’ve already told me.',
      },
      get_into_details: {
        title: 'Get into the details',
        description: 'You can make tweaks to refine your idea once the first draft is complete.',
      },
      show_examples_v2: {
        title: 'Show visual examples',
        description: 'After your draft is complete, upload an image or file so Airo can match your vision.',
      },
      ask_one_change: {
        title: 'Ask for one change at a time',
        description: 'Focus on one change at a time to guide your draft to a strong finished product.',
      },
    }

    it.each([
      { suffix: 'b', label: 'Variant B — "Building your project... give me a minute"' },
      { suffix: 'c', label: 'Variant C — "Working on your project — almost there!"' },
      { suffix: 'd', label: 'Variant D — "Building your site... loading images... writing copy"' },
      { suffix: 'e', label: 'Variant E — "Nothing to do yet, just sit back and relax"' },
    ])('renders the shared treatment card set with default copy for $label', ({ suffix }) => {
      mockVariantPackage = {
        tipIds: treatmentTipIds,
        tipCopyDefaults: treatmentTipCopyDefaults,
        buildingAppMessageKey: `builder_preview_building_app_${suffix}`,
        buildingAppDefaultMessage: `Building app variant ${suffix}`,
        loadingAppMessageKey: `builder_preview_loading_app_${suffix}`,
        loadingAppDefaultMessage: `Loading app variant ${suffix}`,
      }

      renderWithProviders(<Tips />)

      const cards = screen.getAllByTestId('tip-card')
      expect(cards.length).toBe(4)
      expect(within(cards[0] as HTMLElement).getByText('Start with the big picture')).toBeInTheDocument()
      expect(screen.queryByText(`builder_tips_${treatmentTipIds[0]}_title`)).not.toBeInTheDocument()
      expect(screen.queryByText(`builder_tips_${tips[0]}_title`)).not.toBeInTheDocument()
    })

    it('rotates through the treatment tip cards after the dwell timeout', () => {
      mockVariantPackage = {
        tipIds: treatmentTipIds,
        tipCopyDefaults: treatmentTipCopyDefaults,
        buildingAppMessageKey: 'builder_preview_building_app_b',
        buildingAppDefaultMessage: 'Building your project... give me a minute',
        loadingAppMessageKey: 'builder_preview_loading_app_b',
        loadingAppDefaultMessage: 'Loading your project... give me a minute',
      }

      renderWithProviders(<Tips />)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS)
      })
      act(() => {
        frontCardAnimationCallback.current?.()
      })

      const cards = screen.getAllByTestId('tip-card')
      expect(
        within(cards[0] as HTMLElement).getByText(treatmentTipCopyDefaults.get_into_details.title),
      ).toBeInTheDocument()
    })
  })

  describe('progress tracker card', () => {
    it('renders the tracker alongside a manual-nav tip card', () => {
      renderWithProviders(<Tips showProgressTracker />)

      expect(screen.getByTestId('build-progress-tracker')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous tip' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next tip' })).toBeInTheDocument()
    })

    it('keeps the copy static — does not auto-advance after the dwell window', () => {
      renderWithProviders(<Tips showProgressTracker />)

      expect(screen.getAllByText(`builder_tips_${tips[0]}_title`).length).toBeGreaterThan(0)

      act(() => {
        vi.advanceTimersByTime(CARD_DWELL_MS * 3)
      })

      // The tracker keeps ticking, but the tip copy must not rotate on its own.
      expect(screen.getAllByText(`builder_tips_${tips[0]}_title`).length).toBeGreaterThan(0)
      expect(screen.queryByText(`builder_tips_${tips[1]}_title`)).not.toBeInTheDocument()
    })

    it('advances the copy only when the next-tip nav is clicked', () => {
      renderWithProviders(<Tips showProgressTracker />)

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Next tip' }))
      })

      expect(screen.getAllByText(`builder_tips_${tips[1]}_title`).length).toBeGreaterThan(0)
      expect(screen.queryByText(`builder_tips_${tips[0]}_title`)).not.toBeInTheDocument()
    })

    it('logs a click analytics event for each tip-nav arrow', () => {
      renderWithProviders(<Tips showProgressTracker />)

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Next tip' }))
      })
      expect(mockLogAnalytics).toHaveBeenCalledWith(
        'progressTracker.tipNav',
        expect.objectContaining({ direction: 'next' }),
        expect.objectContaining({ kind: 'click', eid: 'develop.progressTracker.tipNext' }),
      )

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Previous tip' }))
      })
      expect(mockLogAnalytics).toHaveBeenCalledWith(
        'progressTracker.tipNav',
        expect.objectContaining({ direction: 'prev' }),
        expect.objectContaining({ kind: 'click', eid: 'develop.progressTracker.tipPrev' }),
      )
    })
  })
})
