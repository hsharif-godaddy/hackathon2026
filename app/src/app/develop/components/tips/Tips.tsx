'use client'

import { motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader } from '@airo-ux/loader'
import Box from '@ux/box'

import { tips } from '@/app/develop/components/tips/tips-content'
import { MD_BREAKPOINT } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'

const CARD_DWELL_MS = 12000

const CYCLING_ELLIPSIS_INTERVAL_MS = 400
const CYCLING_ELLIPSIS_PHASE_COUNT = 4
/** Same visual width as three "." so the base title does not shift while dots cycle. */
const ELLIPSIS_NBSP = '\u00A0'
const ELLIPSIS_SLOT_COUNT = 3

/** Horizontal stack: visible sliver of adjacent cards below md breakpoint. */
const CARD_SIDE_PEEK_PX = 14

interface TipsProps {
  buildingMessage?: string | null
  showTips?: boolean
}

/**
 * Tips carousel with stacked cards and cycling ellipsis.
 * Cards advance in canonical order (1 → 2 → 3 → 4 → 1).
 * Desktop: vertical z-stack. Mobile: horizontal fan.
 */
export default function Tips({ buildingMessage = null, showTips = true }: TipsProps) {
  const t = useTranslations()
  const [isHorizontalStack, setIsHorizontalStack] = useState(false)
  const [orderedTips, setOrderedTips] = useState(() => [...tips])
  const [exitingTip, setExitingTip] = useState<string | null>(null)
  const [ellipsisPhase, setEllipsisPhase] = useState(0)
  const orderedTipsRef = useRef(orderedTips)
  const exitingTipRef = useRef<string | null>(null)
  const rotationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getSlot = (index: number) => {
    if (index === 0) return 'front'
    if (index === 1) return 'second'
    if (index === 2) return 'third'
    return 'hidden'
  }

  const getAnimateSlot = (index: number) => {
    if (exitingTip === null) {
      return getSlot(index)
    }
    if (index === 0) {
      return 'exitFront'
    }
    return getSlot(index - 1)
  }

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
      x: 0, y: 0, z: 0,
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

  const cardVariants = isHorizontalStack
    ? horizontalCardVariants
    : verticalCardVariants

  const cardTransition = {
    duration: 0.75,
    ease: [0.4, 0, 0.2, 1] as const,
  }

  useEffect(() => {
    orderedTipsRef.current = orderedTips
  }, [orderedTips])

  useEffect(() => {
    const query = `(max-width: ${MD_BREAKPOINT - 1}px)`
    const mq = window.matchMedia(query)
    function sync() {
      setIsHorizontalStack(mq.matches)
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

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

  const complete = () => {
    if (!exitingTipRef.current) {
      return
    }

    setOrderedTips((prev) =>
      prev.length === 0 ? prev : [...prev.slice(1), prev[0]!],
    )
    exitingTipRef.current = null
    setExitingTip(null)
    scheduleNextRotation()
  }

  useEffect(() => {
    scheduleNextRotation()

    return () => {
      if (rotationTimeoutRef.current) {
        clearTimeout(rotationTimeoutRef.current)
      }
    }
  }, [scheduleNextRotation])

  useEffect(() => {
    if (buildingMessage == null) {
      return
    }

    setEllipsisPhase(0)

    const id = setInterval(function tickEllipsis() {
      setEllipsisPhase(
        (phase) => (phase + 1) % CYCLING_ELLIPSIS_PHASE_COUNT,
      )
    }, CYCLING_ELLIPSIS_INTERVAL_MS)

    return () => clearInterval(id)
  }, [buildingMessage])

  const loaderTitle =
    buildingMessage != null
      ? `${buildingMessage.replace(/\.+$/, '')}${'.'.repeat(ellipsisPhase)}${ELLIPSIS_NBSP.repeat(ELLIPSIS_SLOT_COUNT - ellipsisPhase)}`
      : t('builder_tips_message')

  return (
    <Box className="h-full mt-6" blockAlignChildren="center" inlineAlignChildren="center" gap="xl">
      <Loader title={loaderTitle} />

      {showTips && (
        <Box className="w-full max-w-2xl px-3" gap="md">
          <Box
            className="relative min-h-36 overflow-x-hidden md:overflow-x-visible"
            style={{ perspective: '1200px', transformStyle: 'preserve-3d' }}
          >
            {orderedTips.slice(0, 4).map((tip, index) => (
              <motion.div
                key={tip}
                className="absolute inset-x-0 top-0 rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-2"
                initial={false}
                animate={getAnimateSlot(index)}
                variants={cardVariants}
                transition={cardTransition}
                style={{ transformStyle: 'preserve-3d' }}
                onAnimationComplete={
                  index === 0
                    ? function onFrontStackAnimationComplete() {
                        if (
                          !exitingTipRef.current ||
                          exitingTipRef.current !== tip
                        ) {
                          return
                        }
                        complete()
                      }
                    : undefined
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
            <div className="pointer-events-none opacity-0 rounded-lg border px-2.5 py-2">
              <div className="text-base font-semibold">
                {t(`builder_tips_${orderedTips[0] ?? tips[0]}_title`)}
              </div>
              <div className="text-sm">
                {t(`builder_tips_${orderedTips[0] ?? tips[0]}_description`)}
              </div>
            </div>
          </Box>
        </Box>
      )}
    </Box>
  )
}
