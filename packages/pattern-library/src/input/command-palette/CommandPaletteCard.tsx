import type { JSX, ReactNode } from 'react';

import { ActionCard } from '../../primitives/action-card';
import { useCommandPaletteEntry } from './CommandPaletteContext';

export interface CommandPaletteCardProps {
  /** Stable id — React key, option DOM id, and `onSelect`/activation target. */
  id: string;
  /** Card glyph, stacked above the title. */
  icon: ReactNode;
  /** Card title — doubles as its accessible name and (when a string) its default search text. */
  title: ReactNode;
  /** Selection callback, fired on click or keyboard activation. */
  onSelect?: () => void;
  /** Disable the card. */
  disabled?: boolean;
  /** Search text; defaults to `title` when it is a string. Required for a non-string title. */
  filterText?: string;
  /** Extra search terms appended to `filterText`. */
  keywords?: string[];
  /** Test id, forwarded to the card. */
  'data-testid'?: string;
  /** Click-event instrumentation id, forwarded to the card. */
  'data-eid'?: string;
}

/**
 * A quick-action card inside `CommandPalette.Cards`. Wraps {@link ActionCard} with
 * the palette's option semantics: it registers for filtering, highlights via
 * the shared `aria-activedescendant`, and stays out of the tab order
 * (`tabIndex={-1}`) so focus remains in the search field.
 *
 * @see {@link CommandPaletteCardProps} for the full prop reference.
 */
export function CommandPaletteCard({
  id,
  icon,
  title,
  onSelect,
  disabled = false,
  filterText,
  keywords,
  'data-testid': testId,
  'data-eid': eid,
}: CommandPaletteCardProps): JSX.Element {
  const labelText: string = filterText ?? (typeof title === 'string' ? title : '');
  const searchText: string =
    keywords && keywords.length > 0 ? `${labelText} ${keywords.join(' ')}` : labelText;

  const { visible, active, activate, optionId } = useCommandPaletteEntry({
    id,
    text: searchText,
    disabled,
    onSelect,
  });

  return (
    <ActionCard
      id={optionId}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      hidden={!visible}
      icon={icon}
      title={title}
      active={active}
      disabled={disabled}
      data-testid={testId}
      data-eid={eid}
      onClick={activate}
    />
  );
}
