'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Box from '@ux/box'
import ClockIcon from '@ux/icon/clock'

import { ProgressTrackerCard } from '@/app/[market]/develop/components/tips/ProgressTrackerCard'
import { shuffleArray } from '@/app/[market]/develop/components/tips/tips-content'
import {
  ANIMATED_CARD_TRANSITION,
  getSlot,
  horizontalCardVariants,
  naturalHeightsPxEqual,
  REDUCED_MOTION_CARD_TRANSITION,
  STACK_WINDOW_SIZE,
  stackLazyShowBody,
  TIP_CARD_HEIGHT_RESIZE_EASE_CLASS,
  TIP_CARD_SHELL_BASE_CLASS,
  TIP_CARD_SHELL_VERTICAL_CHROME_PX,
  TIP_STACK_UNIFORM_SLACK_PX,
  VERTICAL_STACK_PERSPECTIVE_PX,
  VERTICAL_STACK_STEP_PX,
  verticalCardVariants,
} from '@/app/[market]/develop/components/tips/tips-stack-config'
import {
  maxNaturalTipHeightsPx,
  verticalLazyInnerFloorPx,
} from '@/app/[market]/develop/components/tips/tips-stack-measures'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { EXPERIMENT_IDS } from '@/config/experiments'
import { useBuildingTipsVariant } from '@/experiments/building-tips-variant/useBuildingTipsVariant'
import { useAnalytics } from '@/hooks/useAnalytics'
import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'
import { logger } from '@/lib/request-context'

/** Minimum dwell time before advancing; calibrated to the longest translated tip (~12s read at 200 wpm). */
export const CARD_DWELL_MS = 12000

interface TipsProps {
  buildingMessage?: string | null
  buildingDescription?: string | null
  showTips?: boolean
  showProgressTracker?: boolean
  staticTipTitle?: string | null
  staticTipDescription?: string | null
  timeEstimateMinutes?: number | null
  onTimeEstimateShown?: () => void
}

/**
 * Tips carousel with stacked cards.
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
  showProgressTracker = false,
  staticTipTitle = null,
  staticTipDescription = null,
  timeEstimateMinutes = null,
  onTimeEstimateShown,
}: TipsProps) {
  const hasStaticTip = staticTipTitle != null && staticTipDescription != null
  const t = useTranslations()
  const { isMdBreakpoint } = useBreakpoints()
  const reduceMotion = useReducedMotion()
  const isHorizontalStack = !isMdBreakpoint
  const { tipIds, tipCopyDefaults } = useBuildingTipsVariant()
  const appId: string = useAppIdFromParams()
  const { logAnalytics } = useAnalytics({ experimentId: EXPERIMENT_IDS.aabProgressTracker })
  const [orderedTips, setOrderedTips] = useState(() => shuffleArray(tipIds))

  function tipTitle(id: string | undefined) {
    return t(`builder_tips_${id}_title`, undefined, id ? tipCopyDefaults[id]?.title : undefined)
  }
  function tipDescription(id: string | undefined) {
    return t(`builder_tips_${id}_description`, undefined, id ? tipCopyDefaults[id]?.description : undefined)
  }
  const [exitingTip, setExitingTip] = useState<string | null>(null)
  const orderedTipsRef = useRef(orderedTips)
  const exitingTipRef = useRef<string | null>(null)
  const rotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-rotation runs only in the standalone stacked-tips carousel. In the
  // unified progress-tracker card the copy stays put and advances only when the
  // user clicks the ‹ / › nav, so the tracker is the sole animating element.
  const autoRotateEnabled = showTips && !hasStaticTip && !showProgressTracker
  const autoRotateEnabledRef = useRef(autoRotateEnabled)
  useEffect(() => {
    autoRotateEnabledRef.current = autoRotateEnabled
    if (!autoRotateEnabled && rotationTimeoutRef.current) {
      clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }
  }, [autoRotateEnabled])

  // Fire the "pill shown" impression from the pill's own render, so it counts
  // only when the user actually sees the estimate (not merely when gating passes).
  useEffect(() => {
    if (timeEstimateMinutes != null) {
      onTimeEstimateShown?.()
    }
  }, [timeEstimateMinutes, onTimeEstimateShown])

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
  const spacerTip = orderedTips[exitingTip ? 1 : 0] ?? tipIds[0]

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

  // The active variant (and thus tipIds) can resolve after mount — Hivemind
  // cohort assignment and the QA override are both read in effects. Re-seed the
  // carousel when the tip set actually changes so the cards follow the variant
  // instead of staying stuck on the mount-time (control) set.
  const tipIdsKey = useMemo(() => tipIds.join('\0'), [tipIds])
  const seededTipIdsKeyRef = useRef(tipIdsKey)
  useEffect(function reseedOnVariantChange() {
    if (seededTipIdsKeyRef.current === tipIdsKey) {
      return
    }
    seededTipIdsKeyRef.current = tipIdsKey
    exitingTipRef.current = null
    setExitingTip(null)
    setOrderedTips(shuffleArray(tipIds))
  }, [tipIds, tipIdsKey])

  const scheduleNextRotation = useCallback(() => {
    if (rotationTimeoutRef.current) {
      clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }

    // In the progress-tracker card the copy is manual-only — never self-advance.
    if (!autoRotateEnabledRef.current) {
      return
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

  const rotateNext = useCallback(function next() {
    logAnalytics(
      'progressTracker.tipNav',
      { appId, direction: 'next' },
      { kind: 'click', eid: 'develop.progressTracker.tipNext' },
    )
    if (exitingTipRef.current) return
    if (orderedTipsRef.current.length < 2) return
    if (rotationTimeoutRef.current) {
      clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }
    setOrderedTips((current) =>
      current.length < 2 ? current : [...current.slice(1), current[0]!],
    )
    scheduleNextRotation()
  }, [scheduleNextRotation, logAnalytics, appId])

  const rotatePrev = useCallback(function prev() {
    logAnalytics(
      'progressTracker.tipNav',
      { appId, direction: 'prev' },
      { kind: 'click', eid: 'develop.progressTracker.tipPrev' },
    )
    if (exitingTipRef.current) return
    if (orderedTipsRef.current.length < 2) return
    if (rotationTimeoutRef.current) {
      clearTimeout(rotationTimeoutRef.current)
      rotationTimeoutRef.current = null
    }
    setOrderedTips((current) =>
      current.length < 2 ? current : [current[current.length - 1]!, ...current.slice(0, -1)],
    )
    scheduleNextRotation()
  }, [scheduleNextRotation, logAnalytics, appId])

  const loaderTitle = buildingMessage ?? t('builder_tips_message')

  const loaderDescription = buildingDescription ?? undefined

  const ghostStackHeightPx =
    unifiedStackMinHeightPx > 0
      ? isHorizontalStack
        ? unifiedStackMinHeightPx
        : VERTICAL_STACK_STEP_PX * (STACK_WINDOW_SIZE - 1) + unifiedStackMinHeightPx
      : undefined

  const firstTip = visibleTips[0]
  const progressTip = firstTip
    ? { title: tipTitle(firstTip), description: tipDescription(firstTip) }
    : null

  return (
    <Box className="h-full mt-6" blockAlignChildren="center" inlineAlignChildren="center" gap="lg">
      {showProgressTracker && showTips && !hasStaticTip ? (
        <ProgressTrackerCard
          title={loaderTitle}
          timeEstimateMinutes={timeEstimateMinutes}
          tip={progressTip}
          onPrev={rotatePrev}
          onNext={rotateNext}
        />
      ) : (
        /* ── Original layout (no progress tracker) ── */
        <>
          <Loader
            title={loaderTitle}
            description={loaderDescription}
          />

          {timeEstimateMinutes != null && (
            <div
              data-testid="build-time-estimate"
              role="status"
              className="flex items-center gap-1.5 rounded-full px-3 py-1"
              style={{
                background: 'rgba(255, 255, 255, 0.5)',
                boxShadow: '0 8px 24px rgba(20, 20, 40, 0.025)',
              }}
            >
              <ClockIcon width={25} height={25} aria-hidden="true" className="text-ai-light" />
              <span className="text-sm" style={{ color: 'rgba(20, 20, 30, 0.78)' }}>
                {t('builder_preview_build_time_estimate', { minutes: timeEstimateMinutes }, 'On average ~{minutes} minutes')}
              </span>
            </div>
          )}

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
                  {tipTitle(visibleTips[0])}
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
                        transformStyle: 'preserve-3d' as const,
                      }
                }
              >
                {visibleTips.map(function renderCard(tip, index) {
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
                          <div className="text-base font-semibold">{tipTitle(tip)}</div>
                          <div className="text-sm">{tipDescription(tip)}</div>
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
                  <div className="text-base font-semibold">{tipTitle(spacerTip)}</div>
                  <div className="text-sm">{tipDescription(spacerTip)}</div>
                </div>
              </div>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
