// Static layout config, Framer variants, and pure helpers for the stacked-tips
// carousel. Extracted from Tips.tsx to keep that component focused on behavior.

/** Number of cards in the visible z-stack (front, second, third) before the hidden recycle slot. */
const VISIBLE_STACK_SLOTS = 3
/** Window rendered from `orderedTips`: visible slots + one hidden slot for the card recycling in. */
export const STACK_WINDOW_SIZE = VISIBLE_STACK_SLOTS + 1

/** Horizontal strip (<md): gap between full-width cards; `translateX` uses `calc(n*100% + n*gap)`. */
const HORIZONTAL_STRIP_GAP_PX = 8
/**
 * Subpixel slack after the inner body floor + `TIP_CARD_SHELL_VERTICAL_CHROME_PX` on
 * each `motion` shell. Horizontal and vertical both use that sum for `unifiedStackMinHeightPx`;
 * vertical deck vertical extent (translateY steps) is added separately on the ghost spacer.
 */
export const TIP_STACK_UNIFORM_SLACK_PX = 6

/**
 * Inner body measure → add to `height` on the `motion` shell (`box-border`):
 * Tailwind `py-2` (16px) + 1px borders (2px) + 4px for descenders / sub-pixel
 * rounding under `overflow-hidden`. Do not reduce to 18 without re-checking clipping.
 */
export const TIP_CARD_SHELL_VERTICAL_CHROME_PX = 22

/** Ease reflow when viewport width changes tip wrapping (not Framer slot motion). */
export const TIP_CARD_SHELL_BASE_CLASS =
  'absolute inset-x-0 top-0 box-border overflow-hidden rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-2'

export const TIP_CARD_HEIGHT_RESIZE_EASE_CLASS =
  'transition-[height] duration-300 ease-out'

/** Vertical deck: translateY offset between resting stack slots. */
export const VERTICAL_STACK_STEP_PX = 12
/** Stronger `translateZ` per slot behind the front (parent uses a short `perspective`). */
const VERTICAL_STACK_DEPTH_Z_STEP_PX = 26
/** Slight scale-down per depth step so the deck reads like physical cards. */
const VERTICAL_STACK_DEPTH_SCALE_SECOND = 0.988
const VERTICAL_STACK_DEPTH_SCALE_THIRD = 0.974
const VERTICAL_STACK_DEPTH_SCALE_HIDDEN = 0.96
/** Shorter = more dramatic foreshortening; vertical stack only (see track `style`). */
export const VERTICAL_STACK_PERSPECTIVE_PX = 580

export const verticalCardVariants = {
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

export const horizontalCardVariants = {
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

export const ANIMATED_CARD_TRANSITION = {
  duration: 0.75,
  ease: [0.4, 0, 0.2, 1] as const,
}
export const REDUCED_MOTION_CARD_TRANSITION = { duration: 0 }

type SlotName = 'front' | 'second' | 'third' | 'hidden'

export function getSlot(index: number): SlotName {
  if (index === 0) return 'front'
  if (index === 1) return 'second'
  if (index === 2) return 'third'
  return 'hidden'
}

/** At rest: only front (index 0) mounts tip copy; during exit, outgoing + next-up (slot 1). */
export function stackLazyShowBody(exitingTip: string | null, index: number) {
  if (exitingTip === null) {
    return index === 0
  }
  return index <= 1
}

export function naturalHeightsPxEqual(
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
