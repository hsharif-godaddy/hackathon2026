import text from '@ux/text';
import type { JSX, ReactNode } from 'react';

export interface CommandPaletteMutedProps {
  /** The de-emphasized label fragment (e.g. a route like `/about`). */
  children?: ReactNode;
}

/**
 * A muted inline label fragment for use inside a `CommandPalette.Item` label —
 * renders its children with the `passive` text emphasis. Use it to de-emphasize
 * part of a label, e.g. the path in `Go to /about`.
 *
 * @example
 * ```tsx
 * <CommandPalette.Item id="about">Go to <CommandPalette.Muted>/about</CommandPalette.Muted></CommandPalette.Item>
 * ```
 */
export function CommandPaletteMuted({ children }: CommandPaletteMutedProps): JSX.Element {
  return <text.span emphasis="passive">{children}</text.span>;
}
