import classnames from 'classnames';
import type { CSSProperties, HTMLAttributes } from 'react';

/**
 * A color value with an optional human-readable name.
 */
export type SwatchColor = {
  /** Any valid CSS color string — hex, hsl, rgb, or named color. */
  color: string;
  /** Display name used as the accessible label and native tooltip. */
  name?: string;
};

/**
 * Props for `ColorSwatch`.
 */
export interface ColorSwatchProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'color' | 'children'> {
  /** The color to display and its optional human-readable name. */
  color: SwatchColor;
  /**
   * Diameter in px.
   *
   * @default 24
   */
  size?: number;
}

/**
 * A single colored circle, inline-sized (24 × 24 by default).
 * Drops in wherever `@ux/icon` would be used.
 *
 * The fill is an arbitrary CSS color and cannot be a design-token; it is the
 * one legitimate inline style on the inner disk. All other styling flows through
 * the `airo-primitives-color-swatch` BEM classes in `styles.css`.
 *
 * @example
 * <ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} />
 */
export function ColorSwatch({
  color,
  size = 24,
  title,
  className,
  'aria-label': ariaLabel,
  style,
  ...rest
}: ColorSwatchProps) {
  const label = ariaLabel ?? color.name ?? color.color;
  const resolvedTitle = title !== undefined ? title : color.name;

  const merged: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: color.color,
    ...style,
  };
  const { backgroundColor: fillBackground, ...outerStyle } = merged;

  return (
    <span
      {...rest}
      role="img"
      aria-label={label}
      title={resolvedTitle}
      className={classnames('airo-primitives-color-swatch', className)}
      style={outerStyle}
    >
      <span
        aria-hidden
        className="airo-primitives-color-swatch__fill"
        style={{ backgroundColor: fillBackground }}
      />
    </span>
  );
}
