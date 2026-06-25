import type { JSX, ReactNode } from 'react';
import { useId } from 'react';

import { OwnerProvider, useCommandPaletteContext } from './CommandPaletteContext';

export interface CommandPaletteCardsProps {
  /** `CommandPalette.Card` children. */
  children?: ReactNode;
  /** Accessible name for the cards group (e.g. "Quick actions"). */
  'aria-label'?: string;
}

/**
 * The horizontal row of `CommandPalette.Card` quick-actions, shown directly below
 * the search field. The row hides itself when the current query matches none of
 * its cards (its cards stay registered so they reappear when the query changes).
 *
 * @see {@link CommandPaletteCardsProps} for the full prop reference.
 */
export function CommandPaletteCards({ children, 'aria-label': ariaLabel }: CommandPaletteCardsProps): JSX.Element {
  const ctx = useCommandPaletteContext();
  const ownerId: string = useId();
  return (
    <OwnerProvider value={ownerId}>
      <div
        role="group"
        aria-label={ariaLabel}
        hidden={!ctx.isOwnerVisible(ownerId)}
        className="airo-input-command-palette__cards"
      >
        {children}
      </div>
    </OwnerProvider>
  );
}
