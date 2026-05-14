'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Box from '@ux/box'

import { shuffleArray, tips } from '@/app/[market]/develop/components/tips/tips-content'
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

/** Horizontal stack: visible sliver of adjacent cards below md breakpoint. */
const CARD_SIDE_PEEK_PX = 14

const verticalCardVariants = {
  front: {
    x: 0, y: 0, z: 0,
    scale: 1, opacity: 1, filter: 'blur(0px)', zIndex: 40,
  },
  second: {
    x: 0, y: 12, z: -14,
    scale: 0.95, opacity: 0.92, filter: 'blur(0px)', zIndex: 30,
  },
  third: {
    x: 0, y: 24, z: -28,
    scale: 0.9, opacity: 0.82, filter: 'blur(0px)', zIndex: 20,
  },
  hidden: {
    x: 0, y: 36, z: -42,
    scale: 0.85, opacity: 0, filter: 'blur(0px)', zIndex: 10,
  },
  exitFront: {
    x: 0, y: -16, z: 28,
    scale: 1.08, opacity: 0, filter: 'blur(2px)', zIndex: 50,
  },
}

const horizontalCardVariants = {
  front: {
    x: '0%', y: 0, z: 0,
    scale: 1, opacity: 1, filter: 'blur(0px)', zIndex: 40,
  },
  second: {
    x: `calc(100% - ${CARD_SIDE_PEEK_PX}px)`, y: 0, z: -14,
    scale: 0.95, opacity: 0.92, filter: 'blur(0px)', zIndex: 30,
  },
  third: {
    x: `calc(200% - ${2 * CARD_SIDE_PEEK_PX}px)`, y: 0, z: -28,
    scale: 0.9, opacity: 0.82, filter: 'blur(0px)', zIndex: 20,
  },
  hidden: {
    x: `calc(300% - ${3 * CARD_SIDE_PEEK_PX}px)`, y: 0, z: -42,
    scale: 0.85, opacity: 0, filter: 'blur(0px)', zIndex: 10,
  },
  exitFront: {
    x: `calc(-100% + ${CARD_SIDE_PEEK_PX}px)`, y: 0, z: 28,
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
 * Desktop: vertical z-stack. Mobile: horizontal fan.
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
  const spacerTip = orderedTips[exitingTip ? 1 : 0] ?? tips[0]

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
      logger.error('tips.rotation.complete-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
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
          <Box
            className="relative min-h-40 overflow-x-hidden md:overflow-x-visible"
            style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}
          >
            {visibleTips.map((tip, index) => (
              <motion.div
                key={tip}
                className="absolute inset-x-0 top-0 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-2"
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
                style={{ transformStyle: 'preserve-3d' }}
                onAnimationComplete={
                  index === 0 && exitingTip !== null ? onFrontStackAnimationComplete : undefined
                }
              >
                <div className="text-base font-semibold">
                  {t(`builder_tips_${tip}_title`)}
                </div>
                <div className="text-sm">
                  {t(`builder_tips_${tip}_description`)}
                </div>
              </motion.div>
            ))}
            {/*
              Ghost spacer sizes the container to the tallest front-card content.
              Only the current front tip is measured — tips rotating in with longer
              translations may temporarily overflow. A future enhancement could use
              ResizeObserver across all visible cards to track the max height.
            */}
            <div aria-hidden="true" className="pointer-events-none opacity-0 rounded-lg border border-transparent px-2.5 py-2">
              <div className="text-base font-semibold">
                {t(`builder_tips_${spacerTip}_title`)}
              </div>
              <div className="text-sm">
                {t(`builder_tips_${spacerTip}_description`)}
              </div>
            </div>
          </Box>
        </Box>
      )}
    </Box>
  )
}
