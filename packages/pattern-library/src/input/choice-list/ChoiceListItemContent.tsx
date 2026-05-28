import Tag from '@ux/tag';
import text from '@ux/text';
import classnames from 'classnames';
import type { ReactNode } from 'react';

/**
 * Props for `ChoiceListItemContent`, the standard lockup that lives inside
 * a `<ChoiceList.Item>`.
 *
 * The component renders three slots in a fixed inline order so every item
 * in a menu has the same rhythm regardless of whether it opts into the
 * optional image:
 *
 * 1. **Number badge** — a small passive-emphasis `@ux/tag` with the option
 *    number (1, 2, 3, …).
 * 2. **Media** — an optional image or icon node, e.g. a 60×60 thumbnail.
 * 3. **Description** — the option's text, rendered through `@ux/text`'s
 *    paragraph variant at `size={-2}` so typography stays compact and
 *    reads like plain chat text.
 */
export interface ChoiceListItemContentProps {
  /**
   * The option indicator (1, 2, 3, … by default). The parent
   * `<ChoiceList>` injects this at render time by cloning the content
   * element with the auto-assigned number (or a custom string via
   * `<ChoiceList.Item letter="X">`). Multi-select steps set this to
   * `undefined` so no badge is rendered.
   *
   * Declared optional so authoring a `<ChoiceListItemContent>` never
   * requires the indicator up-front. If you render outside of a
   * `<ChoiceList.Item>` (e.g. in a story fixture), pass an explicit
   * `letter` so the badge has something to show.
   */
  letter?: string;
  /**
   * Optional media slot rendered between the letter badge and the text.
   * **Decorative only.** The wrapper carries `aria-hidden="true"`, so
   * any `alt` text on an inner `<img>` or accessible name on an inner
   * `<svg>` is hidden from assistive tech by design — the letter badge
   * plus `description` stay the single source of the option's
   * accessible name. Give inner images an empty `alt=""` (or
   * `aria-hidden="true"` on an inner `<svg>`). If the image carries
   * meaning, promote that meaning into `description` instead.
   *
   * Intended for small visual aids — icons, avatars, preview thumbnails;
   * 60×60 is the common thumbnail size. The component doesn't enforce
   * a size, so callers size the image element directly. Must be
   * inline-safe HTML (`<img>`, `<svg>`, `<span>`), because the whole
   * option row lives inside `@ux/button`'s `<span class="ux-button-text">`
   * wrapper — block-level elements (`<div>`, `<p>`) are invalid here.
   */
  image?: ReactNode;
  /**
   * The option's text label. Rendered through `@ux/text`'s `paragraph`
   * variant at `size={-2}` so typography stays compact and reads like
   * plain chat text. Strings are recommended; inline nodes (e.g. a
   * `<strong>` highlight) are fine, but avoid block-level markup —
   * see `image`.
   */
  description: ReactNode;
  /**
   * Extra class name appended to the content root for scoped styling.
   * Prefer authoring a new BEM element under the `airo-input-choice-list`
   * namespace over inline styles.
   */
  className?: string;
}

/**
 * `ChoiceListItemContent` renders the canonical letter-badge / image /
 * text lockup used inside every `<ChoiceList.Item>`. Use it to opt into
 * the richer layout whenever you need an image or icon alongside the
 * option text; plain-string children on `<ChoiceList.Item>` continue to
 * work and are wrapped in this component automatically by `<ChoiceList>`.
 *
 * @example
 * // Explicit: image + description.
 * <ChoiceList onDecision={handleDecision}>
 *   <ChoiceList.Item value="landing">
 *     <ChoiceListItemContent
 *       image={<img src="/previews/landing.png" alt="" width={60} height={60} />}
 *       description="Build a landing page"
 *     />
 *   </ChoiceList.Item>
 * </ChoiceList>
 *
 * @example
 * // Implicit: plain string gets wrapped with the same component.
 * <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
 */
export function ChoiceListItemContent({
  letter,
  image,
  description,
  className,
}: ChoiceListItemContentProps) {
  return (
    <span className={classnames('airo-input-choice-list__item-content', className)}>
      {letter !== undefined ? (
        <Tag
          className="airo-input-choice-list__item-content-letter"
          size="sm"
          emphasis="passive"
          aria-hidden="true"
        >
          {letter}
        </Tag>
      ) : null}
      {image !== undefined ? (
        <span className="airo-input-choice-list__item-content-media" aria-hidden="true">
          {image}
        </span>
      ) : null}
      <text.span
        as="paragraph"
        size={-2}
        className="airo-input-choice-list__item-content-description"
      >
        {description}
      </text.span>
    </span>
  );
}
