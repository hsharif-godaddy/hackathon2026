import type { MotionProps, Transition, Variants } from 'framer-motion';

/**
 * Shared horizontal slide animation for the inbox preview views (conversation
 * list/detail, list pagination, notification settings panel).
 *
 * `direction` drives the slide: `> 0` enters from the right / exits left
 * (forward navigation), `< 0` is the reverse (back navigation), and `0` is a
 * no-op used for the initial mount where no slide should play.
 *
 * NOTE: consumers must spread `slideMotionProps(...)` onto a `motion` element
 * that is a *direct* child of `AnimatePresence` — wrapping it in another
 * component would stop `AnimatePresence` from firing exit animations.
 */
export const slideTransition: Transition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1] as const,
};

export const slideVariants: Variants = {
  enter: (direction: number) => ({
    x: direction === 0 ? 0 : direction > 0 ? '100%' : '-100%',
    opacity: direction === 0 ? 1 : 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction === 0 ? 0 : direction > 0 ? '-100%' : '100%',
    opacity: direction === 0 ? 1 : 0,
  }),
};

type SlideMotionProps = Pick<
  MotionProps,
  'custom' | 'variants' | 'initial' | 'animate' | 'exit' | 'transition'
>;

/**
 * Common `motion` props for a slide view. Pass a `transition` override when a
 * direction needs a different curve (e.g. `{ duration: 0 }` to skip animating
 * the initial mount).
 */
export function slideMotionProps(
  direction: number,
  transition: Transition = slideTransition,
): SlideMotionProps {
  return {
    custom: direction,
    variants: slideVariants,
    initial: 'enter',
    animate: 'center',
    exit: 'exit',
    transition,
  };
}
