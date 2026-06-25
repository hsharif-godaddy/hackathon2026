import type { JSX, ReactNode } from 'react';

import { OwnerProvider, useCommandPaletteContext } from './CommandPaletteContext';

export interface CommandPaletteGroupProps {
  /** Stable id — used as the owner key for its items and to derive the heading id. */
  id: string;
  /** Section heading (e.g. "Prompts", "Pages"). Omit for an unlabeled group. */
  heading?: ReactNode;
  /** `CommandPalette.Item` children. */
  children?: ReactNode;
}

/**
 * A labeled section of `CommandPalette.Item` rows. The whole group — heading
 * included — hides itself when the current query matches none of its items (the
 * items stay registered so the group reappears when the query changes).
 *
 * @see {@link CommandPaletteGroupProps} for the full prop reference.
 */
export function CommandPaletteGroup({ id, heading, children }: CommandPaletteGroupProps): JSX.Element {
  const ctx = useCommandPaletteContext();
  const headingId = `${ctx.listboxId}-group-${id}`;
  return (
    <OwnerProvider value={id}>
      <div
        role="group"
        aria-labelledby={heading != null ? headingId : undefined}
        hidden={!ctx.isOwnerVisible(id)}
        className="airo-input-command-palette__group"
      >
        {heading != null ? (
          <div id={headingId} className="airo-input-command-palette__group-heading">
            {heading}
          </div>
        ) : null}
        {children}
      </div>
    </OwnerProvider>
  );
}
