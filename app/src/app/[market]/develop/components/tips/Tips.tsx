'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Box from '@ux/box'

import { shuffleArray, tips } from '@/app/[market]/develop/components/tips/tips-content'
import {
  maxNaturalTipHeightsPx,
  verticalLazyInnerFloorPx,
} from '@/app/[market]/develop/components/tips/tips-stack-measures'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

/** Minimum dwell time before advancing; calibrated to the longest translated tip (~12s read at 200 wpm). */
export const CARD_DWELL_MS = 12000

const CYCLING_ELLIPSIS_INTERVAL_MS = 400
const CYCLING_ELLIPSIS_PHASE_COUNT = 4
/**
 * U+2008 PUNCTUATION SPACE — renders as narrow-punctuation width in most fonts
 * so the base title does not shift while dots cycle. Visual stability depends
 * on the loader's font supporting this code point; fallback fonts may render
 * it as a regular space.
 */
const ELLIPSIS_PAD = '\u2008'
// Derived so phase 0 produces N pads, phase N-1 produces 0 pads, and no phase
// produces a negative `repeat()` count (RangeError). Bumping PHASE_COUNT alone
// would otherwise crash at the highest phase.
const ELLIPSIS_SLOT_COUNT = CYCLING_ELLIPSIS_PHASE_COUNT - 1

/** Number of cards in the visible z-stack (front, second, third) before the hidden recycle slot. */
const VISIBLE_STACK_SLOTS = 3
/** Window rendered from `orderedTips`: visible slots + one hidden slot for the card recycling in. */
const STACK_WINDOW_SIZE = VISIBLE_STACK_SLOTS + 1

/** Horizontal strip (<md): gap between full-width cards; `translateX` uses `calc(n*100% + n*gap)`. */
const HORIZONTAL_STRIP_GAP_PX = 8
/**
 * Subpixel slack after the inner body floor + `TIP_CARD_SHELL_VERTICAL_CHROME_PX` on
 * each `motion` shell. Horizontal and vertical both use that sum for `unifiedStackMinHeightPx`;
 * vertical deck vertical extent (translateY steps) is added separately on the ghost spacer.
 */
const TIP_STACK_UNIFORM_SLACK_PX = 6

/**
 * Inner body measure → add to `height` on the `motion` shell (`box-border`):
 * Tailwind `py-2` (16px) + 1px borders (2px) + 4px for descenders / sub-pixel
 * rounding under `overflow-hidden`. Do not reduce to 18 without re-checking clipping.
 */
const TIP_CARD_SHELL_VERTICAL_CHROME_PX = 22

/** Ease reflow when viewport width changes tip wrapping (not Framer slot motion). */
const TIP_CARD_SHELL_BASE_CLASS =
  'absolute inset-x-0 top-0 box-border overflow-hidden rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-2'

const TIP_CARD_HEIGHT_RESIZE_EASE_CLASS =
  'transition-[height] duration-300 ease-out'

/** Vertical deck: translateY offset between resting stack slots. */
const VERTICAL_STACK_STEP_PX = 12
/** Stronger `translateZ` per slot behind the front (parent uses a short `perspective`). */
const VERTICAL_STACK_DEPTH_Z_STEP_PX = 26
/** Slight scale-down per depth step so the deck reads like physical cards. */
const VERTICAL_STACK_DEPTH_SCALE_SECOND = 0.988
const VERTICAL_STACK_DEPTH_SCALE_THIRD = 0.974
const VERTICAL_STACK_DEPTH_SCALE_HIDDEN = 0.96
/** Shorter = more dramatic foreshortening; vertical stack only (see track `style`). */
const VERTICAL_STACK_PERSPECTIVE_PX = 580

const verticalCardVariants = {
  front: {
    x: 0, y: 0, z: 6,
    scale: 1, opacity: 1, filter: 'blur(0px)', zIndex: 40,
  },
  second: {
    x: 0, y: VERTICAL_STACK_STEP_PX, z: -VERTICAL_STACK_DEPTH_Z_STEP_PX,
    scale: VERTICAL_STACK_DEPTH_SCALE_SECOND, opacity: 0.92, filter: 'blur(0px)', zIndex: 30,
  },
  third: {
    x: 0, y: VERTICAL_STACK_STEP_PX * 2, z: -2 * VERTICAL_STACK_DEPTH_Z_STEP_PX,
    scale: VERTICAL_STACK_DEPTH_SCALE_THIRD, opacity: 0.82, filter: 'blur(0px)', zIndex: 20,
  },
  hidden: {
    x: 0, y: VERTICAL_STACK_STEP_PX * 3, z: -3 * VERTICAL_STACK_DEPTH_Z_STEP_PX,
    scale: VERTICAL_STACK_DEPTH_SCALE_HIDDEN, opacity: 0, filter: 'blur(0px)', zIndex: 10,
  },
  exitFront: {
    x: 0, y: -16, z: 28,
    scale: 1.08, opacity: 0, filter: 'blur(2px)', zIndex: 50,
  },
}

const horizontalCardVariants = {
  front: {
    x: 0, y: 0, z: 0,
    scale: 1, opacity: 1, filter: 'blur(0px)', zIndex: 40,
  },
  second: {
    x: `calc(100% + ${HORIZONTAL_STRIP_GAP_PX}px)`,
    y: 0,
    z: 0,
    scale: VERTICAL_STACK_DEPTH_SCALE_SECOND, opacity: 1, filter: 'blur(0px)', zIndex: 30,
  },
  third: {
    x: `calc(200% + ${2 * HORIZONTAL_STRIP_GAP_PX}px)`,
    y: 0,
    z: 0,
    scale: VERTICAL_STACK_DEPTH_SCALE_THIRD, opacity: 1, filter: 'blur(0px)', zIndex: 20,
  },
  hidden: {
    x: `calc(300% + ${3 * HORIZONTAL_STRIP_GAP_PX}px)`,
    y: 0,
    z: 0,
    scale: VERTICAL_STACK_DEPTH_SCALE_HIDDEN, opacity: 0, filter: 'blur(0px)', zIndex: 10,
  },
  exitFront: {
    x: `calc(-100% - ${HORIZONTAL_STRIP_GAP_PX}px)`,
    y: 0,
    z: 28,
    scale: 1.08, opacity: 0, filter: 'blur(2px)', zIndex: 50,
  },
}

const ANIMATED_CARD_TRANSITION = {
  duration: 0.75,
  ease: [0.4, 0, 0.2, 1] as const,
}
const REDUCED_MOTION_CARD_TRANSITION = { duration: 0 }

type SlotName = 'front' | 'second' | 'third' | 'hidden'

function getSlot(index: number): SlotName {
  if (index === 0) return 'front'
  if (index === 1) return 'second'
  if (index === 2) return 'third'
  return 'hidden'
}

/** At rest: only front (index 0) mounts tip copy; during exit, outgoing + next-up (slot 1). */
function stackLazyShowBody(exitingTip: string | null, index: number) {
  if (exitingTip === null) {
    return index === 0
  }
  return index <= 1
}

function naturalHeightsPxEqual(
  prev: Partial<Record<string, number>>,
  next: Partial<Record<string, number>>,
): boolean {
  for (const k of Object.keys(next)) {
    if (prev[k] !== next[k]) return false
  }
  for (const k of Object.keys(prev)) {
    if (prev[k] !== next[k]) return false
  }
  return true
}

interface TipsProps {
  buildingMessage?: string | null
  buildingDescription?: string | null
  showTips?: boolean
  staticTipTitle?: string | null
  staticTipDescription?: string | null
}

/**
 * Tips carousel with stacked cards and cycling ellipsis.
 *
 * Cards advance in randomized order (shuffled once per mount). The stacked
 * carousel renders `STACK_WINDOW_SIZE` cards at a time: 3 visible slots
 * (front/second/third) plus a hidden recycle slot. Additional entries in
 * `tips-content.ts` are safe — only the first 4 animate per cycle.
 *
 * Desktop (md+): vertical z-stack with depth. Mobile (<md): full-width cards in a
 * horizontal strip (only the front panel is in view; next panels sit off-screen).
 * Both layouts lazy-mount tip copy on the front at rest (next mounts when rotation starts).
 */
export default function Tips({
  buildingMessage = null,
  buildingDescription = null,
  showTips = true,
  staticTipTitle = null,
  staticTipDescription = null,
}: TipsProps) {
  const hasStaticTip = staticTipTitle != null && staticTipDescription != null
  const t = useTranslations()
  const { isMdBreakpoint } = useBreakpoints()
  const reduceMotion = useReducedMotion()
  const isHorizontalStack = !isMdBreakpoint
  const [orderedTips, setOrderedTips] = useState(() => shuffleArray(tips))
  const [exitingTip, setExitingTip] = useState<string | null>(null)
  const [ellipsisPhase, setEllipsisPhase] = useState(0)
  const orderedTipsRef = useRef(orderedTips)
  const exitingTipRef = useRef<string | null>(null)
  const rotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cardVariants = isHorizontalStack
    ? horizontalCardVariants
    : verticalCardVariants

  const cardTransition = reduceMotion
    ? REDUCED_MOTION_CARD_TRANSITION
    : ANIMATED_CARD_TRANSITION

  const visibleTips = useMemo(
    () => orderedTips.slice(0, Math.min(orderedTips.length, STACK_WINDOW_SIZE)),
    [orderedTips],
  )
  const visibleTipsKey = useMemo(() => visibleTips.join('\0'), [visibleTips])
  const spacerTip = orderedTips[exitingTip ? 1 : 0] ?? tips[0]

  const naturalMeasureHostByTipRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const naturalMeasureBindByTipRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())

  function measureHostRef(tip: string) {
    let bind = naturalMeasureBindByTipRef.current.get(tip)
    if (!bind) {
      bind = function bindMeasureHost(el: HTMLDivElement | null) {
        const hosts = naturalMeasureHostByTipRef.current
        if (el) hosts.set(tip, el)
        else hosts.delete(tip)
      }
      naturalMeasureBindByTipRef.current.set(tip, bind)
    }
    return bind
  }

  const stackTrackRef = useRef<HTMLDivElement>(null)

  const [naturalHeightsPx, setNaturalHeightsPx] = useState<Partial<Record<string, number>>>({})

  const unifiedStackMinHeightPx = useMemo(() => {
    if (isHorizontalStack) {
      const inner = maxNaturalTipHeightsPx(visibleTips, naturalHeightsPx)
      return inner > 0
        ? Math.ceil(inner) + TIP_CARD_SHELL_VERTICAL_CHROME_PX + TIP_STACK_UNIFORM_SLACK_PX
        : 0
    }
    const inner = verticalLazyInnerFloorPx(visibleTips, naturalHeightsPx, exitingTip)
    return inner > 0
      ? Math.ceil(inner) + TIP_CARD_SHELL_VERTICAL_CHROME_PX + TIP_STACK_UNIFORM_SLACK_PX
      : 0
  }, [isHorizontalStack, visibleTips, naturalHeightsPx, exitingTip])

  useLayoutEffect(function syncTipNaturalHeightMeasures() {
    function updateNaturalHeights() {
      const next: Partial<Record<string, number>> = {}
      naturalMeasureHostByTipRef.current.forEach((el, tip) => {
        next[tip] = Math.ceil(
          Math.max(el.getBoundingClientRect().height, el.scrollHeight),
        )
      })
      setNaturalHeightsPx((prev) => (naturalHeightsPxEqual(prev, next) ? prev : next))
    }

    updateNaturalHeights()
    if (typeof ResizeObserver === 'undefined') {
      logger.warn('tips.resize-observer.unavailable', {})
      function onWindowResize() {
        updateNaturalHeights()
      }
      window.addEventListener('resize', onWindowResize)
      return () => {
        window.removeEventListener('resize', onWindowResize)
      }
    }
    const ro = new ResizeObserver(updateNaturalHeights)
    const track = stackTrackRef.current
    if (track) {
      ro.observe(track)
    }
    naturalMeasureHostByTipRef.current.forEach((el) => {
      ro.observe(el)
    })
    return () => {
      ro.disconnect()
    }
  }, [visibleTipsKey, showTips, isHorizontalStack, exitingTip])

  useLayoutEffect(() => {
    orderedTipsRef.current = orderedTips
  }, [orderedTips])

  const scheduleNextRotation = useCallback(() => {
    if (rotationTimeoutRef.current) {
      clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }

    if (orderedTipsRef.current.length < 2) {
      return
    }

    rotationTimeoutRef.current = setTimeout(() => {
      rotationTimeoutRef.current = null

      // Skip re-arming while a rotation is in flight. Re-arm happens inside
      // `complete()`, which is guaranteed to run via the FM `onAnimationComplete`
      // callback OR the watchdog `useEffect` below — both clear `exitingTipRef`
      // before calling `scheduleNextRotation()` again. Removing `exitingTip` from
      // the watchdog's dependency array would silently break this invariant and
      // permanently stall the carousel; keep the dep in sync with this guard.
      if (exitingTipRef.current) {
        return
      }

      if (orderedTipsRef.current.length < 2) {
        return
      }

      const nextExitingTip = orderedTipsRef.current[0]
      exitingTipRef.current = nextExitingTip
      setExitingTip(nextExitingTip)
    }, CARD_DWELL_MS)
  }, [])

  const complete = useCallback(() => {
    if (!exitingTipRef.current) {
      return
    }

    // Defensive: today nothing in this body throws (`scheduleNextRotation` is
    // a thin clearTimeout/setTimeout wrapper and `setOrderedTips` is a React
    // setter), but `complete` is invoked bare from a `setTimeout` task and a
    // Framer Motion callback — both have no React error boundary above them.
    // A future regression that introduces a throw here would otherwise stall
    // the carousel silently with the front card stuck in `exitFront` (opacity
    // 0) and `scheduleNextRotation` never re-armed. The catch mirrors the
    // success-path cleanup (`exitingTipRef`/`exitingTip` reset, rotation
    // re-armed) so an exception is logged AND genuinely recovered from.
    try {
      setOrderedTips((prev) =>
        prev.length === 0 ? prev : [...prev.slice(1), prev[0]!],
      )
      exitingTipRef.current = null
      setExitingTip(null)
      scheduleNextRotation()
    } catch (error) {
      exitingTipRef.current = null
      setExitingTip(null)
      logger.error(
        'tips.rotation.complete-failed',
        undefined,
        {
          error: error instanceof Error ? error : new Error(String(error)),
        },
      )
      scheduleNextRotation()
    }
  }, [scheduleNextRotation])

  const onFrontStackAnimationComplete = useCallback(() => {
    const frontTip = orderedTipsRef.current[0]
    // Defensive: the JSX gate `exitingTip !== null` already prevents the
    // `!exitingTipRef.current` branch in normal flow. Kept so a future refactor
    // that loosens or removes the gate cannot quietly trigger a rotation from
    // an entry-animation callback.
    if (!exitingTipRef.current || exitingTipRef.current !== frontTip) {
      if (exitingTipRef.current) {
        // Should be unreachable: exitingTipRef is set from orderedTipsRef.current[0]
        // at the same instant. Surfacing it here so a state-desync regression is loud.
        logger.warn('tips.animation-complete.state-desync', {
          exitingTip: exitingTipRef.current,
          frontTip,
        })
      }
      return
    }
    complete()
  }, [complete])

  useEffect(() => {
    scheduleNextRotation()

    return () => {
      if (rotationTimeoutRef.current) {
        clearTimeout(rotationTimeoutRef.current)
      }
    }
  }, [scheduleNextRotation])

  // Watchdog: if Framer Motion never fires onAnimationComplete (zero-duration
  // animation, remount mid-transition, same-variant skip), force-complete the
  // rotation so the carousel cannot permanently stall. For reduced motion this
  // also short-circuits the FM callback path entirely.
  useEffect(() => {
    if (exitingTip === null) return
    const timeoutMs = reduceMotion
      ? 0
      : ANIMATED_CARD_TRANSITION.duration * 1000 * 2 + 200
    const id = setTimeout(() => {
      if (exitingTipRef.current) {
        complete()
      }
    }, timeoutMs)
    return () => clearTimeout(id)
  }, [exitingTip, reduceMotion, complete])

  useEffect(() => {
    if (buildingMessage == null || reduceMotion) {
      return
    }

    setEllipsisPhase(0)

    const id = setInterval(function tickEllipsis() {
      setEllipsisPhase(
        (phase) => (phase + 1) % CYCLING_ELLIPSIS_PHASE_COUNT,
      )
    }, CYCLING_ELLIPSIS_INTERVAL_MS)

    return () => clearInterval(id)
  }, [buildingMessage, reduceMotion])

  const baseTitle = buildingMessage != null ? buildingMessage.replace(/\.+$/, '') : null
  const loaderTitle =
    baseTitle != null
      ? reduceMotion
        ? baseTitle
        : `${baseTitle}${'.'.repeat(ellipsisPhase)}${ELLIPSIS_PAD.repeat(ELLIPSIS_SLOT_COUNT - ellipsisPhase)}`
      : t('builder_tips_message')

  const ghostStackHeightPx =
    unifiedStackMinHeightPx > 0
      ? isHorizontalStack
        ? unifiedStackMinHeightPx
        : VERTICAL_STACK_STEP_PX * (STACK_WINDOW_SIZE - 1) + unifiedStackMinHeightPx
      : undefined

  return (
    <Box className="h-full mt-6" blockAlignChildren="center" inlineAlignChildren="center" gap="xl">
      <Loader
        title={loaderTitle}
        description={buildingDescription ?? undefined}
      />

      {showTips && hasStaticTip && (
        <Box className="w-full max-w-2xl px-3" gap="md">
          <Box className="relative min-h-40">
            <div
              className="rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-2"
              role="status"
              aria-live="polite"
            >
              <div className="text-base font-semibold">{staticTipTitle}</div>
              <div className="text-sm">{staticTipDescription}</div>
            </div>
          </Box>
        </Box>
      )}

      {showTips && !hasStaticTip && (
        <Box className="w-full max-w-2xl px-3" gap="md">
          {visibleTips.length > 0 && (
            <div role="status" aria-live="polite" className="sr-only">
              {t(`builder_tips_${visibleTips[0]}_title`)}
            </div>
          )}
          <div
            ref={stackTrackRef}
            className="relative w-full min-h-40 overflow-x-hidden md:overflow-x-visible"
            style={
              isHorizontalStack
                ? undefined
                : {
                    perspective: `${VERTICAL_STACK_PERSPECTIVE_PX}px`,
                    perspectiveOrigin: '50% 32%',
                    transformStyle: 'preserve-3d',
                  }
            }
          >
            {visibleTips.map((tip, index) => {
              const showTipBody = stackLazyShowBody(exitingTip, index)
              const cardReflowEaseClass =
                unifiedStackMinHeightPx > 0 && !reduceMotion
                  ? TIP_CARD_HEIGHT_RESIZE_EASE_CLASS
                  : ''
              const cardClassName = [TIP_CARD_SHELL_BASE_CLASS, cardReflowEaseClass]
                .filter((c) => c.length > 0)
                .join(' ')
              return (
              <motion.div
                key={tip}
                data-testid="tip-card"
                aria-hidden={!showTipBody ? true : undefined}
                className={cardClassName}
                initial={false}
                animate={
                  exitingTip === null
                    ? getSlot(index)
                    : index === 0
                      ? 'exitFront'
                      : getSlot(index - 1)
                }
                variants={cardVariants}
                transition={cardTransition}
                style={{
                  transformOrigin: '50% 0%',
                  transformStyle: 'preserve-3d',
                  ...(unifiedStackMinHeightPx > 0 ? { height: unifiedStackMinHeightPx } : {}),
                }}
                onAnimationComplete={
                  index === 0 && exitingTip !== null ? onFrontStackAnimationComplete : undefined
                }
              >
                {showTipBody ? (
                <div ref={measureHostRef(tip)} className="w-full">
                  <div className="text-base font-semibold">
                    {t(`builder_tips_${tip}_title`)}
                  </div>
                  <div className="text-sm">
                    {t(`builder_tips_${tip}_description`)}
                  </div>
                </div>
                ) : (
                  <div className="min-h-0 w-full" aria-hidden />
                )}
              </motion.div>
              )
            })}
            <div
              aria-hidden="true"
              className={[
                'pointer-events-none box-border opacity-0 rounded-lg border border-transparent px-2.5 py-2',
                ghostStackHeightPx != null && !reduceMotion ? TIP_CARD_HEIGHT_RESIZE_EASE_CLASS : '',
              ]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={ghostStackHeightPx != null ? { height: ghostStackHeightPx } : undefined}
            >
              <div className="text-base font-semibold">
                {t(`builder_tips_${spacerTip}_title`)}
              </div>
              <div className="text-sm">
                {t(`builder_tips_${spacerTip}_description`)}
              </div>
            </div>
          </div>
        </Box>
      )}
    </Box>
  )
}
