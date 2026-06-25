import AsyncIcon from '@ux/icon/async-icon.js';
import { type ChangeEvent, type JSX, type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

import { useCommandPaletteContext } from './CommandPaletteContext';

export interface CommandPaletteSearchProps {
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /** Accessible name for the search field (required — the field has no visible label). */
  'aria-label': string;
  /** Decorative trailing hint, e.g. a `⌘/` shortcut glyph. Announced to no one (`aria-hidden`). */
  hotkeyHint?: ReactNode;
  /** Test id, forwarded to the input. */
  'data-testid'?: string;
}

/**
 * The search field at the top of a `CommandPalette`. A borderless `@ux/icon`
 * magnifier + input row that sits in the palette's top box; the box's bottom
 * edge carries the full-width divider, so the field itself has no frame and the
 * divider is a separator (not a focus indicator).
 *
 * The input is a `role="combobox"` that filters every `CommandPalette.Card` and
 * `CommandPalette.Item` below it, and owns the palette's keyboard model: Arrow
 * Up/Down move the highlight, Enter activates the highlighted option, Escape
 * dismisses. Focus stays here; the highlighted option is tracked via
 * `aria-activedescendant`.
 *
 * @see {@link CommandPaletteSearchProps} for the full prop reference.
 */
export function CommandPaletteSearch({
  placeholder,
  'aria-label': ariaLabel,
  hotkeyHint,
  'data-testid': testId,
}: CommandPaletteSearchProps): JSX.Element {
  const ctx = useCommandPaletteContext();
  const inputRef = useRef<HTMLInputElement>(null);

  // Move focus to the field when the palette opens (this slot mounts on open).
  // Synchronising DOM focus is a legitimate effect; it also works inside the
  // Flyout/BottomSheet portals where `autoFocus` is unreliable.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const activeOptionId: string | undefined =
    ctx.activeId !== null ? ctx.optionId(ctx.activeId) : undefined;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        ctx.moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        ctx.moveActive(-1);
        break;
      case 'Enter':
        if (ctx.activeId !== null) {
          event.preventDefault();
          ctx.activate();
        }
        break;
      case 'Escape':
        event.preventDefault();
        ctx.close();
        break;
      default:
        break;
    }
  };

  return (
    <div className="airo-input-command-palette__search">
      <AsyncIcon icon="search" className="airo-input-command-palette__search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={true}
        aria-controls={ctx.listboxId}
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        className="airo-input-command-palette__search-input"
        placeholder={placeholder}
        value={ctx.searchValue}
        data-testid={testId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => ctx.setSearchValue(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {hotkeyHint != null ? (
        <span className="airo-input-command-palette__search-hint" aria-hidden="true">
          {hotkeyHint}
        </span>
      ) : null}
    </div>
  );
}
