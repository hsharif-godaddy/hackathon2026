import classnames from 'classnames';
import { type ButtonHTMLAttributes, type JSX, type ReactNode, forwardRef } from 'react';

/**
 * Props for {@link ActionCard}.
 *
 * Extends the native `<button>` props (minus `title`, which is repurposed as
 * the visible card title), so consumers can forward `onClick`, `disabled`,
 * `type`, `aria-*`, `data-*`, `id`, `role`, and any other standard button
 * attribute. The card is a stateless trigger — `active` is a purely visual
 * highlight (e.g. roving keyboard focus inside a list); it carries no
 * persistent selected state of its own.
 */
export interface ActionCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Leading glyph stacked above the title (e.g. `<AsyncIcon icon="attachment" />`). Decorative — wrapped `aria-hidden`. */
  icon: ReactNode;
  /** Title rendered below the icon. Doubles as the card's visible/accessible label. */
  title: ReactNode;
  /**
   * Visual highlight, independent of `:hover`/`:focus`. Drive this from a
   * parent's roving-focus / active-descendant state to mark the card as the
   * current candidate without moving DOM focus to it.
   * @default false
   */
  active?: boolean;
}

/**
 * A low-contrast tile that stacks an icon over a title — the quick-action card
 * used in command palettes, empty states, and action grids. Renders a real
 * `<button>`, so it is keyboard- and screen-reader-operable out of the box and
 * forwards every native button attribute.
 *
 * Surface and text are bound to the `actionControl` intent family (the same
 * family as control/secondary buttons); `:hover` and the `active` highlight
 * shift to the matched `actionControlHovered` pair.
 *
 * @example
 * ```tsx
 * <ActionCard icon={<AsyncIcon icon="attachment" />} title="Attach" onClick={attach} />
 * ```
 *
 * @see {@link ActionCardProps} for the full prop reference.
 */
export const ActionCard = forwardRef<HTMLButtonElement, ActionCardProps>(function ActionCard(
  { icon, title, active = false, className, type, ...rest }: ActionCardProps,
  ref,
): JSX.Element {
  // Default `type="button"` so a card inside a `<form>` does not submit it.
  const resolvedType: ButtonHTMLAttributes<HTMLButtonElement>['type'] = type ?? 'button';
  return (
    <button
      ref={ref}
      type={resolvedType}
      className={classnames(
        'airo-primitives-action-card',
        active && 'airo-primitives-action-card--active',
        className,
      )}
      {...rest}
    >
      <span className="airo-primitives-action-card__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="airo-primitives-action-card__title">{title}</span>
    </button>
  );
});
