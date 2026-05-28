import AsyncIcon from '@ux/icon/async-icon.js';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type JSX,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  forwardRef,
} from 'react';

/**
 * Props for {@link MentionChip}.
 *
 * Extends the native `<span>` props so consumers can forward `data-*`,
 * `aria-*`, `id`, `className`, `style`, etc. The chip is a pure trigger
 * with no persistent "selected" state — its visual states (resting,
 * hover, focus, active) are interaction-driven.
 */
export interface MentionChipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'onSelect' | 'prefix'> {
  /**
   * Optional bold prefix rendered before the label. Typically a small
   * integer like `"1"` (rendered as the visible string `#1`); pass any
   * `ReactNode` if you need a different prefix shape (icon, abbreviation).
   * The literal `#` glyph is added by the component, so callers should
   * pass just the value (`prefix={1}`, not `prefix="#1"`).
   */
  prefix?: ReactNode;
  /**
   * The chip's visible text following the prefix (e.g. `"Button"`,
   * `"Section"`). Required — a chip with no label has no accessible
   * meaning.
   */
  label: ReactNode;
  /**
   * Fired when the chip body is activated via mouse click, `Enter`, or
   * `Space`. Intended for "navigate to / focus on the referenced thing"
   * semantics — pair with a host-side scroll/highlight handler.
   *
   * Clicks that originate inside the trailing remove button are ignored
   * here so callers don't have to disambiguate the two actions.
   */
  onActivate?: () => void;
  /**
   * When provided, renders a trailing `✕` button. Fired when the user
   * clicks or keyboard-activates the remove button. Click events do not
   * bubble up to {@link onActivate}.
   *
   * Omit to hide the remove affordance entirely (read-only chip).
   */
  onRemove?: () => void;
  /**
   * Accessible name for the trailing remove button. Only used when
   * `onRemove` is provided.
   * @default "Remove"
   */
  removeLabel?: string;
}

/**
 * Inline chip primitive for "mention"-shaped references — a small,
 * interactive badge that points to a numbered entity in some host
 * document tree (e.g. an element in a canvas, a layer in a design, a row
 * in a list).
 *
 * The chip renders a non-button surface with `role="button"` so it can
 * legally host a real `<button>` for the remove affordance — nested
 * `<button>` elements are invalid HTML, and that constraint is what
 * forces the role-on-span pattern. The body is `contentEditable={false}`
 * so the chip behaves as a single atomic unit when embedded in a Lexical
 * (or any other) contenteditable surface — selection, copy, and delete
 * all operate on the whole chip rather than its inner text.
 *
 * Visual states track `@ux/chip`'s three-state token family —
 * `actionControl` (resting), `actionControlHovered` (hover), and
 * `actionControlFocused` (keyboard focus) — so the chip reads as
 * visually consistent with UXCore2 chips at every interaction state.
 * Hover/focus styles only apply when `onActivate` is wired (i.e. the
 * chip is actually interactive); read-only chips keep their resting
 * tokens on hover so they don't read as clickable. Spacing is sized as
 * fractional multiples of `intent('ux.box.density')` so the chip tracks
 * the active theme's density token.
 *
 * @example
 * ```tsx
 * <MentionChip
 *   prefix={1}
 *   label="Button"
 *   onActivate={() => scrollToElement(1)}
 *   onRemove={() => removeMention(1)}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Read-only chip — no remove affordance
 * <MentionChip prefix={3} label="Section" onActivate={focusSection} />
 * ```
 */
export const MentionChip = forwardRef<HTMLSpanElement, MentionChipProps>(function MentionChip(
  {
    prefix,
    label,
    onActivate,
    onRemove,
    removeLabel = 'Remove',
    className,
    onClick,
    onKeyDown,
    onMouseDown,
    ...rest
  }: MentionChipProps,
  ref,
): JSX.Element {
  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // Ignore clicks that originate inside the remove button so the two
    // actions stay independent at the call site.
    if ((event.target as HTMLElement).closest('button')) return;
    onActivate?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if ((event.target as HTMLElement).closest('button')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate?.();
    }
  };

  const handleMouseDown = (event: MouseEvent<HTMLSpanElement>) => {
    onMouseDown?.(event);
    if (event.defaultPrevented) return;
    // Only suppress the default mousedown when the chip lives inside a
    // contenteditable surface. Inside a Lexical (or any other) editor,
    // the default would collapse the selection into the chip's atomic
    // node and steal focus from the editor — surprising and visually
    // janky. Outside of a contenteditable host the default is exactly
    // what we want: pointer-down focus on a `role="button"` affordance,
    // so the chip's focus ring follows the click.
    const host = (event.currentTarget as HTMLElement).closest(
      '[contenteditable=""],[contenteditable="true"]',
    );
    if (host) event.preventDefault();
  };

  // The chip body is only interactive when a caller supplies `onActivate`.
  // When it's not, drop `role="button"` + `tabIndex` so AT users don't see a
  // phantom focusable button that does nothing — the chip becomes a plain
  // inline atom (the trailing remove `<button>` is still focusable on its own).
  const isInteractive = Boolean(onActivate);

  return (
    <span
      ref={ref}
      className={classnames('airo-primitives-mention-chip', className)}
      contentEditable={false}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      {...rest}
    >
      {prefix !== undefined && prefix !== null && prefix !== '' && (
        <span className="airo-primitives-mention-chip__prefix">#{prefix}</span>
      )}
      <span className="airo-primitives-mention-chip__label">{label}</span>
      {onRemove && (
        <button
          type="button"
          className="airo-primitives-mention-chip__remove"
          aria-label={removeLabel}
          onMouseDown={(event) => {
            // Block the parent span's mousedown handler so the editor
            // doesn't see a focus event on the chip body when the user
            // is actually clicking remove. Don't call onRemove here —
            // mousedown fires only for pointer interactions, but the
            // remove action must also work for keyboard users (Enter /
            // Space on a focused button fires `click`, not `mousedown`).
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            // Click fires for both pointer activation AND keyboard
            // Enter/Space on the focused button — the canonical place
            // to wire the remove action. stopPropagation keeps the
            // parent span's click handler from firing `onActivate`.
            event.stopPropagation();
            onRemove();
          }}
        >
          <AsyncIcon icon="x-thick" aria-hidden="true" />
        </button>
      )}
    </span>
  );
});
