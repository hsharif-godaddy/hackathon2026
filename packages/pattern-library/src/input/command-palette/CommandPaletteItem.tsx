import classnames from 'classnames';
import type { JSX, ReactNode } from 'react';

import { useCommandPaletteEntry } from './CommandPaletteContext';

export interface CommandPaletteItemProps {
  /** Stable id — React key, option DOM id, and `onSelect`/activation target. */
  id: string;
  /** Row label. May contain styled fragments (e.g. `CommandPalette.Muted`); see `filterText`. */
  children: ReactNode;
  /** Optional leading icon (e.g. `<AsyncIcon icon="wand" />`). A reserved slot keeps labels aligned when omitted. */
  icon?: ReactNode;
  /** Optional right-aligned shortcut hint (e.g. `⌘K` or `G A`). Decorative — the component does not bind the key. */
  hotkey?: ReactNode;
  /** Selection callback, fired on click or keyboard activation. */
  onSelect?: () => void;
  /** Disable the row: stays visible (dimmed) but is skipped by keyboard nav and activation. */
  disabled?: boolean;
  /**
   * Text used for search matching. **Required when `children` is not a plain
   * string** (a styled label has no inherent searchable text); defaults to the
   * string label otherwise.
   */
  filterText?: string;
  /** Extra search terms appended to `filterText` (synonyms, abbreviations). */
  keywords?: string[];
  /** Test id, forwarded to the row. */
  'data-testid'?: string;
  /** Click-event instrumentation id, forwarded to the row. */
  'data-eid'?: string;
  /** Accessible label override (defaults to the rendered label text). */
  'aria-label'?: string;
}

/**
 * A single command row inside a `CommandPalette.Group` (or directly under
 * `CommandPalette`). Renders a non-focusable `role="option"` whose label can mix
 * styled fragments (via `CommandPalette.Muted`) and carry a right-aligned `hotkey`
 * hint. Focus stays in the search field; this row highlights via the palette's
 * `aria-activedescendant`.
 *
 * @see {@link CommandPaletteItemProps} for the full prop reference.
 */
export function CommandPaletteItem({
  id,
  children,
  icon,
  hotkey,
  onSelect,
  disabled = false,
  filterText,
  keywords,
  'data-testid': testId,
  'data-eid': eid,
  'aria-label': ariaLabel,
}: CommandPaletteItemProps): JSX.Element {
  const labelText: string = filterText ?? (typeof children === 'string' ? children : '');
  const searchText: string =
    keywords && keywords.length > 0 ? `${labelText} ${keywords.join(' ')}` : labelText;

  const { visible, active, activate, optionId } = useCommandPaletteEntry({
    id,
    text: searchText,
    disabled,
    onSelect,
  });

  return (
    // biome-ignore lint/a11y/useSemanticElements: combobox+listbox activedescendant pattern requires a non-focusable role="option"; focus stays in the search field
    <div
      id={optionId}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      hidden={!visible}
      data-testid={testId}
      data-eid={eid}
      className={classnames('airo-input-command-palette__item', {
        'airo-input-command-palette__item--disabled': disabled,
      })}
      onClick={disabled ? undefined : activate}
    >
      <span className="airo-input-command-palette__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="airo-input-command-palette__item-label">{children}</span>
      {hotkey != null ? (
        <span className="airo-input-command-palette__item-hotkey" aria-hidden="true">
          {hotkey}
        </span>
      ) : null}
    </div>
  );
}
