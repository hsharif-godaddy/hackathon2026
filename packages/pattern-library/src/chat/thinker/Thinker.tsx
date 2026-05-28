import Box from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { ThinkingIndicator } from '../../primitives/thinking-indicator/index';
import { ThinkerChecklist } from './ThinkerChecklist';
import { ThinkerChecklistItem } from './ThinkerChecklistItem';
import { ThinkerReasoningBlock } from './ThinkerReasoningBlock';
import { ThinkerStep } from './ThinkerStep';
import { ThinkerTimeline } from './ThinkerTimeline';
import { ThinkerCompleteContext } from './context';

const DEFAULT_STATUS_LABEL = 'Working…';
const DEFAULT_SHOW_DETAILS_LABEL = 'Show details';
const DEFAULT_HIDE_DETAILS_LABEL = 'Hide details';

function pickLabel(...values: Array<string | undefined>) {
  for (const value of values) {
    const trimmedValue = value?.trim();

    if (trimmedValue) {
      return trimmedValue;
    }
  }
}

/**
 * Shared props for the root `Thinker` status surface.
 */
export interface ThinkerProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Label shown beside the animated indicator. When `showAnimation` is false
   * the label still renders (useful for showing "Done" styling with a tag).
   */
  label?: string;
  /**
   * Whether to render the animated dots. Defaults to `true`. Set to `false`
   * to render a static/resolved state regardless of whether work is ongoing.
   * @default true
   */
  showAnimation?: boolean;
  /**
   * Replaces the default thinking graphic with a custom React node. Pass a
   * configured `<ThinkingIndicator variant="spinner" />`, an icon, or any
   * other animated element. The node is rendered inside an `aria-hidden`
   * wrapper because the parent status row already provides the accessible
   * live region. Only rendered when `showAnimation` is `true`.
   *
   * **Decorative content only.** The indicator slot is meant for animated
   * graphics, icons, or other non-interactive imagery. The wrapper is
   * `aria-hidden` (so screen readers don't double-announce) and `inert`
   * (so focusable descendants are removed from the tab order entirely).
   * Together those close the most common a11y mistake — a focusable
   * element inside a hidden subtree that traps keyboard focus while AT
   * users can't perceive it. Pass focusable controls as siblings of the
   * `Thinker` instead, where they remain interactive and announced.
   *
   * Falsy non-element values (`undefined`, `null`, `false`, `0`, `''`) are
   * all treated as "no override" and fall back to the default
   * `<ThinkingIndicator />`. To suppress the indicator entirely, set
   * `showAnimation={false}` instead.
   * @default `<ThinkingIndicator />` (three bouncing dots)
   */
  indicator?: ReactNode;
  /**
   * Controlled open state for the optional details panel. Pair with
   * `onOpenChange`. Ignored if there are no details children.
   * @see defaultOpen
   * @see onOpenChange
   */
  open?: boolean;
  /**
   * Initial open state when uncontrolled. Defaults to `false`.
   * @default false
   * @see open
   * @see onOpenChange
   */
  defaultOpen?: boolean;
  /**
   * Called when the user toggles the panel. Fires in controlled and
   * uncontrolled modes.
   * @see open
   * @see defaultOpen
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Preferred explicit label for the status region.
   *
   * Use this when the component renders without a visible `label`, or when the
   * assistive-technology copy needs to differ from the visible label. If this
   * prop is omitted, the effective status name falls back to a native
   * `aria-label` HTML attribute, then `label`, then `"Working…"`.
   */
  ariaLabel?: string;
  /**
   * Optional reasoning block rendered above the header. Pass a
   * `<Thinker.Reasoning>` or `<Thinker.ReasoningBlock>` to show the LLM's raw
   * internal thought stream in a collapsible surface that starts collapsed to
   * three lines.
   */
  reasoningBlock?: ReactNode;
  /**
   * When `true`, an animated gradient mask shimmers left-to-right over the
   * label text, signalling that the AI is actively streaming.
   * Defaults to `showAnimation` so resolved states (`showAnimation={false}`)
   * are never animated unless the consumer explicitly opts in.
   * Automatically suppressed by `prefers-reduced-motion`.
   * @default showAnimation
   */
  shimmer?: boolean;
  /**
   * Details panel contents. Use `<Thinker.Timeline>` or `<Thinker.Checklist>`
   * for the recommended semantics.
   */
  children?: ReactNode;
  /**
   * Accessible label for the collapsed disclosure trigger when details content
   * is present. Override the default to localize or tailor the copy.
   * @default "Show details"
   */
  showDetailsLabel?: string;
  /**
   * Accessible label for the expanded disclosure trigger when details content
   * is present. Override the default to localize or tailor the copy.
   * @default "Hide details"
   */
  hideDetailsLabel?: string;
  /**
   * When `true`, the Thinker renders its resolved/"complete" layout:
   *
   * - The reasoning block and details children stack **above** the label.
   * - The label itself becomes the disclosure trigger (inline link button
   *   with a chevron). No separate icon-only toggle renders.
   * - Sub-content starts hidden and reveals all at once on click.
   * - Any nested `Thinker.Reasoning` bypasses its 3-line preview so the
   *   entire reasoning stream is visible when revealed.
   *
   * Pair with `showAnimation={false}` for a static "Done" state. This prop is
   * independent of `showAnimation` so products can decide timing.
   *
   * @deprecated Use [`Milestone`](../milestone/README.md) for "agent
   *   finished" UI instead. The done-state shape moved unchanged —
   *   reasoning panel above the label, label-as-disclosure trigger — so
   *   the migration is mechanical:
   *
   *   ```tsx
   *   // Before
   *   <Thinker complete showAnimation={false} label="Saved" reasoningBlock={r}>
   *     {checklist}
   *   </Thinker>
   *
   *   // After
   *   <Milestone label="Saved" reasoningBlock={r}>{checklist}</Milestone>
   *   ```
   *
   *   `Milestone` additionally exposes first-class `actions` and a
   *   `feedback` (thumbs-up / thumbs-down + reason picker) affordance
   *   that `Thinker.complete` cannot express. `complete` will be
   *   removed in a future release.
   * @default false
   */
  complete?: boolean;
}

/**
 * `Thinker` is a chat-surface "AI is working" indicator with optional
 * compound slots. Generic status and control labels ship with sane defaults
 * and can be overridden when a product needs localized or domain-specific
 * wording.
 *
 * Compound slots:
 * - `<Thinker.Reasoning>` / `<Thinker.ReasoningBlock>` — raw LLM thought
 *   stream, collapsible to 3
 *   lines, rendered above the header.
 * - `<Thinker.Timeline>` + `<Thinker.Step>` — structured chain-of-thought
 *   steps in the collapsible panel below the header.
 */
function ThinkerRoot({
  label,
  showAnimation = true,
  shimmer,
  indicator,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  showDetailsLabel,
  hideDetailsLabel,
  className,
  reasoningBlock,
  children,
  complete = false,
  ...rest
}: ThinkerProps) {
  const effectiveShimmer = shimmer ?? showAnimation;

  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const isOpen = isControlled ? openProp : internalOpen;
  const hasPanelContent = Boolean(children) || (complete && Boolean(reasoningBlock));
  const hasChildren = Boolean(children);

  const panelId = useId();

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const handleToggle = useCallback(() => {
    setOpen(!isOpen);
  }, [isOpen, setOpen]);

  // When `complete` flips from false → true, force the panel closed so the
  // new "details-above-label" layout reveals in its collapsed form.
  // Transition ordering (3 → 4 → 2 → 1) falls out of a single render tick:
  //   3) isOpen is reset here (before paint of the new layout),
  //   4) the ThinkerCompleteContext provider flips, so ThinkerReasoningBlock
  //      re-renders at full height inside the now-hidden panel,
  //   2) the render swaps DOM order so the panel sits above the label,
  //   1) the label renders as the link-button trigger.
  // Only fires when uncontrolled; consumers that own `open` keep control.
  const previousCompleteRef = useRef(complete);
  useLayoutEffect(() => {
    const wasComplete = previousCompleteRef.current;
    previousCompleteRef.current = complete;
    if (!wasComplete && complete && !isControlled && isOpen) {
      // Route through `setOpen` so `onOpenChange` fires alongside the state
      // change — consumers observing the callback see the forced close.
      // Guard on `isOpen` so we don't emit a redundant `onOpenChange(false)`
      // when the panel was already closed.
      setOpen(false);
    }
  }, [complete, isControlled, isOpen, setOpen]);

  const statusLabel = pickLabel(ariaLabel, ariaLabelAttribute, label) ?? DEFAULT_STATUS_LABEL;
  const toggleLabel = isOpen
    ? (pickLabel(hideDetailsLabel) ?? DEFAULT_HIDE_DETAILS_LABEL)
    : (pickLabel(showDetailsLabel) ?? DEFAULT_SHOW_DETAILS_LABEL);

  const labelNode = label ? (
    <TextLockup
      className={classnames('airo-chat-thinker__label', {
        'airo-chat-thinker__label--shimmer': effectiveShimmer,
      })}
      size="sm"
    >
      {label}
    </TextLockup>
  ) : null;

  const statusRegion = (
    <span
      className="airo-chat-thinker__status"
      role="status"
      aria-live="polite"
      aria-label={statusLabel}
    >
      {showAnimation ? (
        // `aria-hidden` hides the indicator from assistive tech (the outer
        // status span is the live region). `inert` complements that by
        // removing every focusable descendant from the tab order, so a
        // consumer who passes a focusable element (against the prop's
        // "decorative only" contract) can't create a keyboard trap that's
        // unreachable for screen reader users. The runtime DOM receives the
        // boolean attribute correctly; the `@ts-expect-error` matches the
        // established repo convention for the React 18 typing gap (see
        // `ChoiceList`, `PromptBox`, `PanelChrome`).
        //
        // `||` (not `??`) so every falsy non-element ReactNode (`false`,
        // `null`, `undefined`, `0`, `''`) is treated as "no override" and
        // falls back to the default. The slot is for visible animated
        // graphics; a stray `0` or empty-string would render as a literal
        // text node here (which is the wrong UX) and a `false`/`null`
        // would leave an invisible empty wrapper. Suppressing the
        // indicator entirely is `showAnimation={false}`.
        <span
          className="airo-chat-thinker__indicator"
          aria-hidden="true"
          // @ts-expect-error — `inert` is a valid HTML attribute not yet typed in @types/react@18
          inert=""
        >
          {indicator || <ThinkingIndicator size={0.75} />}
        </span>
      ) : null}
      {labelNode}
    </span>
  );

  return (
    <ThinkerCompleteContext.Provider value={complete}>
      <div
        {...rest}
        className={classnames(
          'airo-chat-thinker',
          { 'airo-chat-thinker--complete': complete },
          className,
        )}
      >
        <Box orientation="vertical" gap="sm" data-partial="componentAiro">
          {complete ? (
            <>
              {hasPanelContent ? (
                <div id={panelId} className="airo-chat-thinker__panel" hidden={!isOpen}>
                  <Box orientation="vertical" gap="sm" data-partial="componentAiro">
                    {reasoningBlock ?? null}
                    {children}
                  </Box>
                </div>
              ) : null}
              <Box
                orientation="horizontal"
                gap="sm"
                className="airo-chat-thinker__header airo-chat-thinker__header--complete"
                data-partial="componentAiro"
              >
                {hasPanelContent ? (
                  <Button
                    design="inline"
                    size="small"
                    className="airo-chat-thinker__label-button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={handleToggle}
                    text={label?.trim() || DEFAULT_SHOW_DETAILS_LABEL}
                    icon={
                      <AsyncIcon
                        icon="chevron-up"
                        className={classnames('airo-chat-thinker__caret', {
                          'airo-chat-thinker__caret--open': isOpen,
                        })}
                      />
                    }
                  />
                ) : (
                  statusRegion
                )}
              </Box>
            </>
          ) : (
            <>
              {reasoningBlock ?? null}
              <Box
                orientation="horizontal"
                gap="sm"
                className="airo-chat-thinker__header"
                data-partial="componentAiro"
              >
                {statusRegion}
                {hasChildren ? (
                  <Button
                    design="inline"
                    size="small"
                    className="airo-chat-thinker__toggle"
                    aria-label={toggleLabel}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={handleToggle}
                    icon={
                      <AsyncIcon
                        icon="chevron-down"
                        className={classnames('airo-chat-thinker__caret', {
                          'airo-chat-thinker__caret--open': isOpen,
                        })}
                      />
                    }
                  />
                ) : null}
              </Box>

              {hasChildren ? (
                <div id={panelId} className="airo-chat-thinker__panel" hidden={!isOpen}>
                  {children}
                </div>
              ) : null}
            </>
          )}
        </Box>
      </div>
    </ThinkerCompleteContext.Provider>
  );
}

/**
 * Public API: `Thinker` plus its compound `Timeline` and `Step` slots.
 * Attached after declaration so all names resolve to the correct functions
 * while keeping the file tree-shakeable.
 *
 * @example
 * <Thinker label="Generating a response" />
 */
export const Thinker = Object.assign(ThinkerRoot, {
  Reasoning: ThinkerReasoningBlock,
  ReasoningBlock: ThinkerReasoningBlock,
  Timeline: ThinkerTimeline,
  Step: ThinkerStep,
  Checklist: ThinkerChecklist,
  ChecklistItem: ThinkerChecklistItem,
});
