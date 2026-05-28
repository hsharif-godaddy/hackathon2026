import classnames from 'classnames';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { ThinkerCompleteContext } from './context';

const DEFAULT_EXPAND_LABEL = 'Expand reasoning';

/**
 * Props for the `Thinker` reasoning surface rendered above the main status row.
 */
export interface ThinkerReasoningBlockProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Streaming text or any React content representing the LLM's internal
   * thought process. Append-only updates work correctly — do not replace the
   * whole string on every tick.
   */
  children?: ReactNode;
  /**
   * Called when the block transitions from collapsed to expanded. Receives
   * `true` when expanded.
   */
  onExpandChange?: (expanded: boolean) => void;
  /**
   * Accessible label for the expand disclosure control shown when the
   * reasoning stream overflows the collapsed 3-line preview. Override the
   * default to localize or tailor the copy.
   * @default "Expand reasoning"
   */
  expandLabel?: string;
}

/**
 * `ThinkerReasoningBlock` renders the LLM's raw internal thought stream in a
 * collapsible block that sits above the main Thinker header.
 *
 * Behaviour:
 * - Collapses to 3 lines (3em) by default, showing the *most recent* text at
 *   the bottom (via `justify-content: flex-end` + `overflow: hidden`).
 * - A `useLayoutEffect` compares the child's natural `scrollHeight` to the
 *   computed 3em collapsed-height cap in pixels (`maxCollapsedPx`). We
 *   measure the child rather than the container because `flex-end` causes
 *   upward overflow that the container's `scrollHeight` would not capture.
 * - When content overflows, a top-to-transparent fade overlay and a
 *   transparent full-area button appear, allowing users to expand to full
 *   height.
 * - Once expanded, the affordance disappears. There is no collapse trigger.
 * - `aria-live="polite"` / `aria-atomic="false"` ensure AT users receive
 *   streaming updates without interruption.
 *
 * @example
 * <Thinker.Reasoning>{reasoningText}</Thinker.Reasoning>
 */
export function ThinkerReasoningBlock({
  children,
  className,
  onExpandChange,
  expandLabel,
  ...rest
}: ThinkerReasoningBlockProps) {
  const trimmedExpandLabel = expandLabel?.trim();
  const effectiveExpandLabel = trimmedExpandLabel || DEFAULT_EXPAND_LABEL;
  // When nested inside a `complete` Thinker, bypass the 3-line preview
  // entirely: render the full content, skip the measure effect, and do not
  // show the fade overlay or inner expand affordance. The parent disclosure
  // is the only way to reveal or hide the reasoning in that mode.
  const isComplete = useContext(ThinkerCompleteContext);
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const effectiveExpanded = isComplete || isExpanded;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `children` drives a DOM re-measure; the effect doesn't read it directly but must re-run when rendered content changes.
  useLayoutEffect(() => {
    // Bypass measuring entirely in complete mode — the content is always
    // fully expanded and the parent owns visibility.
    if (isComplete) {
      const el = containerRef.current;
      if (el) {
        el.style.maxHeight = '';
      }
      if (needsCollapse) {
        setNeedsCollapse(false);
      }
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    if (isExpanded) {
      // Once the expand transition has completed, the inline style is cleared
      // and `max-height: none` (from the --expanded class) takes over. Any
      // further content streaming while expanded can grow freely — nothing to do.
      if (el.style.maxHeight === '') return;

      const child = el.firstElementChild as HTMLElement | null;
      const fullHeight = child?.scrollHeight ?? 0;

      // Users who prefer reduced motion get an instant jump; the CSS
      // `transition: none` in the media query suppresses the animation anyway,
      // but we also skip the transitionend dance to avoid leaving a stale
      // inline style if the event never fires.
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prefersReducedMotion || fullHeight === 0) {
        el.style.maxHeight = '';
        return;
      }

      // Animate from the current collapsed px value to the full content height,
      // then clear the inline style so `max-height: none` takes over and future
      // streaming content can grow without a cap.
      el.style.maxHeight = `${fullHeight}px`;
      const clear = () => {
        el.style.maxHeight = '';
      };
      el.addEventListener('transitionend', clear, { once: true });
      return () => el.removeEventListener('transitionend', clear);
    }

    const child = el.firstElementChild as HTMLElement | null;
    const childHeight = child?.scrollHeight ?? 0;
    // Derive 3em in pixels from the element's own font-size so the cap
    // respects the consumer's typography scale.
    const computedFontSize = Number.parseFloat(getComputedStyle(el).fontSize);
    const maxCollapsedPx = (Number.isFinite(computedFontSize) ? computedFontSize : 16) * 3;
    // Setting an explicit pixel value (not a static CSS keyword) means the
    // browser can transition between successive values as content streams in.
    el.style.maxHeight = `${Math.min(childHeight, maxCollapsedPx)}px`;
    setNeedsCollapse(childHeight > maxCollapsedPx);
  }, [isExpanded, children, isComplete]);

  const handleExpand = useCallback(() => {
    setIsExpanded(true);
    onExpandChange?.(true);
  }, [onExpandChange]);

  return (
    <div {...rest} className={classnames('airo-chat-thinker__reasoning-block-wrapper', className)}>
      <div
        ref={containerRef}
        className={classnames('airo-chat-thinker__reasoning-block', {
          'airo-chat-thinker__reasoning-block--collapsed': !effectiveExpanded,
          'airo-chat-thinker__reasoning-block--expanded': effectiveExpanded,
        })}
      >
        <div
          id={contentId}
          className="airo-chat-thinker__reasoning-block-content"
          aria-live="polite"
          aria-atomic="false"
        >
          {children}
        </div>
      </div>

      {!isComplete && needsCollapse && !isExpanded && (
        <>
          <div className="airo-chat-thinker__reasoning-block-fade" aria-hidden="true" />
          <button
            type="button"
            className="airo-chat-thinker__reasoning-block-expand"
            aria-label={effectiveExpandLabel}
            aria-controls={contentId}
            aria-expanded={isExpanded}
            onClick={handleExpand}
          />
        </>
      )}
    </div>
  );
}
