import text from '@ux/text';
import classnames from 'classnames';
import type { CSSProperties, HTMLAttributes } from 'react';

import { ColorSwatch } from '../color-swatch/ColorSwatch';
import type { SwatchColor } from '../color-swatch/ColorSwatch';

/**
 * Props for `ColorSwatchGroup`.
 */
export interface ColorSwatchGroupProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** The colors to display. */
  swatches: SwatchColor[];
  /**
   * Maximum visible swatches before truncation.
   *
   * @default 5
   *
   * Values less than 1 are treated as 1.
   */
  max?: number;
  /**
   * Diameter in px for each swatch and the overflow circle.
   *
   * @default 24
   */
  size?: number;
  /**
   * Builds the accessible name for the overflow `role="img"` chip. Only invoked when
   * that chip is rendered, with a **positive** `overflowCount` (hidden swatches after
   * the visible row). Defaults to English `` `${count} more colors` ``. Use for i18n
   * or custom phrasing.
   */
  getOverflowAriaLabel?: (overflowCount: number) => string;
}

/**
 * A horizontally stacked row of color swatches with ~33% overlap (margin −size/3).
 *
 * When `swatches.length` exceeds `max`, renders `max − 1` swatches followed
 * by an overflow circle showing the remaining count. Stacking order is driven
 * by DOM order (no z-index): the rightmost swatch and the overflow circle sit
 * on top.
 *
 * @example
 * <ColorSwatchGroup
 *   swatches={[{ color: '#E03B2F', name: 'Cayenne' }, { color: '#2F5FE0' }]}
 *   aria-label="Brand palette"
 * />
 */
export function ColorSwatchGroup({
  swatches,
  max = 5,
  size = 24,
  getOverflowAriaLabel,
  className,
  style,
  ...rest
}: ColorSwatchGroupProps) {
  const clampedMax = Math.max(1, max);
  const truncated = swatches.length > clampedMax;
  const visible = truncated ? swatches.slice(0, clampedMax - 1) : swatches;
  const overflowCount = truncated ? Math.max(0, swatches.length - visible.length) : 0;
  const showOverflowChip = overflowCount > 0;
  const overflowLabel = showOverflowChip
    ? (getOverflowAriaLabel?.(overflowCount) ?? `${overflowCount} more colors`)
    : '';

  return (
    <span
      {...rest}
      // biome-ignore lint/a11y/useSemanticElements: not a form control group; inline row cannot use fieldset
      role="group"
      className={classnames('airo-primitives-color-swatch-group', className)}
      style={{ '--airo-swatch-size': `${size}px`, ...style } as CSSProperties}
    >
      {visible.map((swatch, i) => (
        <ColorSwatch
          // biome-ignore lint/suspicious/noArrayIndexKey: stacking order is positional; duplicate colors are allowed
          key={i}
          color={swatch}
          size={size}
          className="airo-primitives-color-swatch-group__item"
        />
      ))}
      {showOverflowChip && (
        <span
          role="img"
          className="airo-primitives-color-swatch-group__overflow airo-primitives-color-swatch-group__item"
          aria-label={overflowLabel}
          style={{ width: size, height: size } as CSSProperties}
        >
          <text.span as="label" size={-2} aria-hidden="true">
            +{overflowCount}
          </text.span>
        </span>
      )}
    </span>
  );
}
