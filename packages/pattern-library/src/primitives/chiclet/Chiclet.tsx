import AsyncIcon from '@ux/icon/async-icon.js';
import classnames from 'classnames';
import { type ButtonHTMLAttributes, type JSX, type ReactNode, forwardRef } from 'react';

/**
 * Props for {@link Chiclet}.
 *
 * Extends the native `<button>` props, so consumers can forward
 * `onClick`, `disabled`, `type`, `aria-*`, `data-*`, `id`, `name`, and any
 * other standard button attribute. The chiclet is a pure trigger — it
 * has no persistent "active" or "selected" state. All visual states
 * (default, hover/focus, pressed) are interaction-driven and revert to
 * the default surface as soon as the user stops engaging.
 */
export interface ChicletProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual + accessible label content. Falls back to the string `"Ask Airo"`
   * so the canonical Airo trigger renders correctly with no props. Pass any
   * `ReactNode` to customise the label (e.g. translated copy).
   * @default "Ask Airo"
   */
  children?: ReactNode;
  /**
   * Override the leading wand icon. Pass `false` to hide it entirely (icon-
   * less label-only chiclet). Any `ReactNode` replaces the default wand —
   * useful for context-specific triggers (e.g. a sparkle, a robot, etc.).
   * Defaults to the `@ux/icon` `wand` glyph.
   */
  icon?: ReactNode | false;
  /**
   * Visual size of the chiclet. Mirrors `@ux/button`'s `size` prop:
   *
   * - `"medium"` (default) — `calc(intent('ux.box.density') * 2)` block ×
   *   `calc(intent('ux.box.density') * 3)` inline padding at the inherited
   *   font-size. Use as the primary Airo CTA on a row.
   * - `"small"` — `calc(intent('ux.box.density') * 1)` block ×
   *   `calc(intent('ux.box.density') * 2)` inline padding at
   *   `var(--uxText--fontSize-1)` (~14px), matching `@ux/button size="small"`.
   *   Use when the chiclet sits inline with other small buttons (toolbars,
   *   compact action rows, secondary surfaces).
   *
   * Gap, icon size, and ring thickness scale automatically with the
   * inherited font-size — no other knobs needed.
   * @default "medium"
   */
  size?: 'medium' | 'small';
}

const DEFAULT_LABEL = 'Ask Airo';

/**
 * Airo-branded pill-shaped trigger button — the canonical "Ask Airo"
 * call-to-action. Pairs the wand icon with a label inside a rounded
 * surface ringed by an animated Airo-purple gradient border.
 *
 * The gradient border rotates once on mount (subtle attention pull when
 * the trigger first appears) and continuously while hovered or
 * keyboard-focused (live invitation to interact). Both animations
 * respect `prefers-reduced-motion: reduce` and collapse to a static
 * tinted ring when the user has opted out.
 *
 * Surface, text, and icon colors are bound to the `actionSecondary`
 * intent family (`ux.actionSecondary{,Hovered,Chosen}.{background,foreground}Color`).
 * The root element carries `data-partial="componentAiro"` so those intents
 * resolve to the Airo-flavored values (lavender hover, deep-purple pressed)
 * regardless of the surrounding page's base theme — the chiclet always
 * reads as "Airo" even when dropped into a plain Antares surface. Consumers
 * can override by passing their own `data-partial` (e.g. inside an
 * `inverted` section that sets its own scope).
 *
 * The chiclet is a pure trigger — it has no persistent "active" state.
 * The filled-dark "pressed" appearance is wired to `:active` (mouse
 * held / Space depressed) for transient click feedback only. Whatever
 * the chiclet opens (panel, drawer, modal) is responsible for its own
 * lifecycle; the chiclet's visual state never depends on that external
 * truth.
 *
 * @example
 * ```tsx
 * <Chiclet onClick={openAiroPanel} />
 * ```
 *
 * @example
 * ```tsx
 * // Custom label
 * <Chiclet onClick={openAiroPanel}>Try Airo</Chiclet>
 * ```
 *
 * @example
 * ```tsx
 * // Custom label + custom icon
 * <Chiclet icon={<SparkleIcon />}>Try Airo</Chiclet>
 * ```
 */
export const Chiclet = forwardRef<HTMLButtonElement, ChicletProps>(function Chiclet(
  { children, icon, size = 'medium', className, type, ...rest }: ChicletProps,
  ref,
): JSX.Element {
  // Default `type="button"` so a Chiclet inside a `<form>` does not
  // accidentally submit it. Consumers can opt in to "submit" / "reset"
  // by passing `type` explicitly.
  const resolvedType = type ?? 'button';

  // Resolve the icon slot:
  //   undefined  → default wand glyph
  //   false      → no icon
  //   ReactNode  → consumer-provided element
  // The `aria-hidden` on the icon wrapper keeps screen readers from
  // double-announcing the icon alongside the visible label text.
  const showIcon = icon !== false;
  const iconNode = icon === undefined ? <AsyncIcon icon="wand" /> : icon;

  // Empty `children` (undefined / null / "") falls back to the string
  // `"Ask Airo"` rather than rendering a label-less chiclet, which would
  // ship a button with no accessible name.
  const labelNode =
    children === undefined || children === null || children === '' ? DEFAULT_LABEL : children;

  return (
    <button
      ref={ref}
      type={resolvedType}
      // `data-partial="componentAiro"` scopes the Antares Theme Partial
      // for this subtree to the ComponentAiro (Light) palette, so
      // `actionSecondary*` intents resolve to the Airo-flavored values
      // captured in Figma (lavender hover, deep-purple pressed) instead
      // of the plain Antares secondary-button colors. Placed before the
      // spread so consumers can opt out by passing their own
      // `data-partial` (e.g. `data-partial="inverted"` inside an
      // inverted section).
      data-partial="componentAiro"
      className={classnames(
        'airo-primitives-chiclet',
        // Only emit the modifier class for non-default sizes — keeps the
        // default render's class list minimal and matches the BEM
        // convention of "absent modifier means default."
        size === 'small' && 'airo-primitives-chiclet--small',
        className,
      )}
      {...rest}
    >
      {showIcon && (
        <span className="airo-primitives-chiclet__icon" aria-hidden="true">
          {iconNode}
        </span>
      )}
      <span className="airo-primitives-chiclet__label">{labelNode}</span>
    </button>
  );
});
