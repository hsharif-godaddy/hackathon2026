import { useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

/** Smoke-and-mirrors timer: each stage advances after this duration. */
export const STAGE_DURATION_MS = 60_000

/** Tick interval for sub-progress animation (must divide evenly into STAGE_DURATION_MS). */
const TICK_MS = 200
/** Number of ticks before stage 0 activates (800ms intro delay). */
const INTRO_TICKS = 4
/** Ticks per stage. */
const TICKS_PER_STAGE = STAGE_DURATION_MS / TICK_MS
/** Past the final stage, the trailing bar creeps toward this fraction but never reaches it. */
const TRAILING_MAX_FILL = 0.9
/** Creep time constant in ticks (larger = slower). 600 ticks ≈ 2 min. */
const TRAILING_TAU_TICKS = 600

export interface ProgressTrackerState {
  /** Index of the active stage, or -1 during the intro delay. */
  activeStage: number
  /** Within-stage fill ratio (0–1) for the active connector. */
  subProgress: number
  /** Trailing creep ratio (0–1) shown on the final stage once it is passed. */
  trailingProgress: number
}

/**
 * Drives the decorative build-progress stepper. A single tick counter advances
 * the active stage every STAGE_DURATION_MS (1 minute) and derives the
 * within-stage fill plus the post-final trailing creep. Reduced-motion keeps the
 * discrete stage advance but drops the continuous fill and creep. Isolated from
 * the component so the timing can be tested without mounting any JSX.
 */
export function useProgressTracker(stageCount: number): ProgressTrackerState {
  // Respect OS "reduce motion": stages still advance (discrete), but we drop
  // the continuous within-stage fill and the trailing creep animation.
  const reduceMotion: boolean | null = useReducedMotion()
  // Single tick counter drives all state — avoids chained effects.
  const [ticks, setTicks] = useState<number>(0)

  useEffect(function startTicker() {
    const id = setInterval(() => setTicks((n) => n + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // effectiveTick < 0: pre-start (nothing lit); >= 0: counting into stages.
  const effectiveTick: number = ticks - INTRO_TICKS
  const activeStage: number = effectiveTick < 0
    ? -1
    : Math.min(Math.floor(effectiveTick / TICKS_PER_STAGE), stageCount - 1)
  // Once the final stage is reached, hold its incoming connector full (never
  // reset) and start a slow trailing creep instead of looping the fill.
  const pastFinal: boolean = effectiveTick >= stageCount * TICKS_PER_STAGE
  const subProgress: number = effectiveTick < 0
    ? 0
    : reduceMotion
      ? (pastFinal ? 1 : 0)
      : pastFinal
        ? 1
        : (effectiveTick % TICKS_PER_STAGE) / TICKS_PER_STAGE
  // Trailing bar past "Finishing touches": creeps toward the end, asymptotes
  // below 100% (never completes), and never resets or comes back. Skipped
  // entirely for reduced-motion users.
  const trailingProgress: number = !reduceMotion && pastFinal
    ? TRAILING_MAX_FILL * (1 - Math.exp(-(effectiveTick - stageCount * TICKS_PER_STAGE) / TRAILING_TAU_TICKS))
    : 0

  return { activeStage, subProgress, trailingProgress }
}
