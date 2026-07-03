import { box } from '@ux/box';
import Button, { type Designs } from '@ux/button';
import Flyout from '@ux/flyout';
import {
  Children,
  type ComponentProps,
  Fragment,
  type JSX,
  type MouseEvent,
  type ReactNode,
  isValidElement,
  useCallback,
  useId,
  useRef,
  useState,
} from 'react';

import { BottomSheet } from '../../surfaces/bottom-sheet';
import { CommandPaletteCard } from './CommandPaletteCard';
import { CommandPaletteCards } from './CommandPaletteCards';
import {
  type CommandPaletteContextValue,
  type CommandPaletteEntry,
  CommandPaletteProvider,
  matchesQuery,
  normalizeQuery,
} from './CommandPaletteContext';
import { CommandPaletteGroup } from './CommandPaletteGroup';
import { CommandPaletteItem } from './CommandPaletteItem';
import { CommandPaletteMuted } from './CommandPaletteMuted';
import { CommandPaletteSearch } from './CommandPaletteSearch';
import { useIsMobile } from '../../utils/useIsMobile';

// ─── Trigger ──────────────────────────────────────────────────────────────

/** Trigger button configuration shared by the desktop and mobile renderings (minus the accessible-name fields). */
interface CommandPaletteTriggerBase {
  /** Trigger icon (e.g. a wand / command glyph). */
  icon?: ReactNode;
  /** UXCore2 button design/intent (e.g. `'control'`, `'inline'`). */
  design?: Designs;
  /** UXCore2 button size. */
  size?: 'sm' | 'md' | 'small';
  /** Test id, forwarded to the trigger button. */
  'data-testid'?: string;
  /** Click-event instrumentation id, forwarded to the trigger button. */
  'data-eid'?: string;
  /** Extra click handler; runs before the popover toggles. */
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  /** Class applied to the trigger button. */
  className?: string;
}

/**
 * Accessible-name requirement for the trigger: a visible `text` label supplies
 * the name, or — for an icon-only trigger — an explicit `aria-label` is
 * required. Mirrors `ResponsiveMenu`/`BottomSheet`: an unnamed trigger fails to
 * typecheck rather than relying on a JSDoc-only convention.
 */
type CommandPaletteTriggerLabel =
  | { /** Trigger label text — doubles as the accessible name. */ text: string; 'aria-label'?: string }
  | { /** Accessible label — required when the trigger is icon-only. */ 'aria-label': string; text?: string };

/** Trigger button configuration, shared by the desktop and mobile renderings. */
export type CommandPaletteTrigger = CommandPaletteTriggerBase & CommandPaletteTriggerLabel;

// ─── Props ──────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Trigger button configuration. */
  trigger: CommandPaletteTrigger;
  /** Slot children — `CommandPalette.Search`, `CommandPalette.Cards`, `CommandPalette.Group`, `CommandPalette.Item`. */
  children?: ReactNode;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  /**
   * Initial open state when uncontrolled.
   * @default false
   */
  defaultOpen?: boolean;
  /** Fires when the popover opens or closes (trigger toggle, selection, Escape, outside click). */
  onOpenChange?: (open: boolean) => void;
  /** Controlled search text. Pair with `onSearchChange`. */
  search?: string;
  /**
   * Initial search text when uncontrolled.
   * @default ''
   */
  defaultSearch?: string;
  /** Fires when the search text changes. */
  onSearchChange?: (value: string) => void;
  /** Fires after any card/item activates, with the activated leaf's `id`. */
  onSelect?: (id: string) => void;
  /**
   * Close the popover after a selection.
   * @default true
   */
  closeOnSelect?: boolean;
  /**
   * Force the desktop (`false`) or mobile (`true`) rendering. Defaults to an
   * internal `matchMedia` breakpoint (< 768px).
   */
  isMobile?: boolean;
  /** Content shown when a non-empty search matches nothing. Defaults to a muted "No results." */
  emptyState?: ReactNode;
  /**
   * Desktop flyout placement, forwarded to `@ux/flyout`. Ignored on mobile.
   * @default 'bottom-start'
   */
  placement?: ComponentProps<typeof Flyout>['placement'];
  /** Optional id base for the popover's listbox/option ids. Auto-generated when omitted. */
  id?: string;
  /** Accessible name for the results listbox (and the mobile sheet fallback). */
  'aria-label'?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Flatten a children tree into a slot list, descending `<>…</>` fragments
 * (which `React.Children.toArray` leaves as a single opaque element). Lets the
 * root recognise `CommandPalette.Search` / `.Cards` / `.Group` slots whether the
 * consumer passes them directly or wrapped in a fragment.
 */
function flattenSlots(children: ReactNode): ReactNode[] {
  const slots: ReactNode[] = [];
  Children.forEach(children, (child: ReactNode) => {
    if (isValidElement(child) && child.type === Fragment) {
      slots.push(...flattenSlots((child.props as { children?: ReactNode }).children));
    } else {
      slots.push(child);
    }
  });
  return slots;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface CommandPaletteComponent {
  (props: CommandPaletteProps): JSX.Element;
  Search: typeof CommandPaletteSearch;
  Cards: typeof CommandPaletteCards;
  Card: typeof CommandPaletteCard;
  Group: typeof CommandPaletteGroup;
  Item: typeof CommandPaletteItem;
  Muted: typeof CommandPaletteMuted;
}

/**
 * `CommandPalette` is a responsive command-palette popover: an anchored `@ux/flyout`
 * on desktop and a `BottomSheet` on mobile (< 768px), composed from slot
 * children. A `CommandPalette.Search` field at the top filters **both** the
 * `CommandPalette.Card` quick-actions and the `CommandPalette.Item` rows; empty groups
 * and the cards row hide themselves when nothing under them matches.
 *
 * Keyboard support follows the combobox + listbox pattern: focus stays in the
 * search field, Arrow Up/Down move the highlight (`aria-activedescendant`)
 * across the visible options, and Enter activates the highlighted one.
 *
 * @example
 * ```tsx
 * <CommandPalette trigger={{ text: 'Open', 'aria-label': 'Commands' }} aria-label="Commands">
 *   <CommandPalette.Search placeholder="Type a command…" aria-label="Search commands" hotkeyHint="⌘/" />
 *   <CommandPalette.Cards aria-label="Quick actions">
 *     <CommandPalette.Card id="attach" icon={<AsyncIcon icon="paperclip" />} title="Attach" onSelect={attach} />
 *   </CommandPalette.Cards>
 *   <CommandPalette.Group id="pages" heading="Pages">
 *     <CommandPalette.Item id="about" icon={<AsyncIcon icon="arrow-up-right" />} hotkey="G A" filterText="go to /about">
 *       Go to <CommandPalette.Muted>/about</CommandPalette.Muted>
 *     </CommandPalette.Item>
 *   </CommandPalette.Group>
 * </CommandPalette>
 * ```
 *
 * @see {@link CommandPaletteProps} for the full prop reference.
 */
export const CommandPalette = function CommandPalette({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  search: searchProp,
  defaultSearch = '',
  onSearchChange,
  onSelect,
  closeOnSelect = true,
  isMobile: isMobileProp,
  emptyState,
  placement = 'bottom-start',
  id,
  'aria-label': ariaLabel = 'Commands',
}: CommandPaletteProps): JSX.Element {
  const internalIsMobile: boolean = useIsMobile();
  const isMobile: boolean = isMobileProp ?? internalIsMobile;

  // ── Open state (controlled / uncontrolled) ────────────────────────────
  const isOpenControlled: boolean = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen: boolean = isOpenControlled ? (openProp as boolean) : internalOpen;

  // ── Search state (controlled / uncontrolled) ──────────────────────────
  const isSearchControlled: boolean = searchProp !== undefined;
  const [internalSearch, setInternalSearch] = useState(defaultSearch);
  const searchValue: string = isSearchControlled ? (searchProp as string) : internalSearch;

  // ── Registry + active highlight ───────────────────────────────────────
  const entriesRef = useRef<Map<string, CommandPaletteEntry>>(new Map());
  // Registry changes (register/unregister) are not derivable from props/state,
  // so a version bump forces the root to re-render and recompute visibility.
  const [, bumpVersion] = useState(0);
  const [rawActiveId, setRawActiveId] = useState<string | null>(null);

  const registerEntry = useCallback((entry: CommandPaletteEntry): (() => void) => {
    entriesRef.current.set(entry.id, entry);
    bumpVersion((v: number) => v + 1);
    return () => {
      entriesRef.current.delete(entry.id);
      bumpVersion((v: number) => v + 1);
    };
  }, []);

  const queryActive: boolean = normalizeQuery(searchValue) !== '';

  // Derived visibility + navigation order. Recomputes only when the query or
  // the registry contents change; reads the registry ref at compute time so
  // mutated entry fields (text/onSelect) stay current without re-registering.
  const visibleIds = new Set<string>();
  const visibleOwners = new Set<string>();
  const navigableIds: string[] = [];
  for (const entry of entriesRef.current.values()) {
    if (matchesQuery(entry.text, searchValue)) {
      visibleIds.add(entry.id);
      visibleOwners.add(entry.ownerId);
      if (!entry.disabled) navigableIds.push(entry.id);
    }
  }

  // The highlight follows an explicit selection when one is set and still
  // visible. Otherwise it auto-points at the first match *only while a query is
  // active* — so typing snaps the highlight to the top result, but opening the
  // palette with an empty query shows no highlight (no card looks pre-hovered
  // before the user interacts).
  const activeId: string | null =
    rawActiveId !== null && navigableIds.includes(rawActiveId)
      ? rawActiveId
      : queryActive
        ? (navigableIds[0] ?? null)
        : null;

  const setSearchValue = useCallback(
    (next: string): void => {
      if (!isSearchControlled) setInternalSearch(next);
      onSearchChange?.(next);
      // Reset the highlight so it snaps to the first match of the new query.
      setRawActiveId(null);
    },
    [isSearchControlled, onSearchChange],
  );

  const close = useCallback((): void => {
    if (!isOpenControlled) setInternalOpen(false);
    onOpenChange?.(false);
  }, [isOpenControlled, onOpenChange]);

  const openPopover = useCallback((): void => {
    if (!isOpenControlled) setInternalOpen(true);
    onOpenChange?.(true);
    // Fresh query + highlight each time the palette opens (uncontrolled search).
    if (!isSearchControlled) setInternalSearch('');
    setRawActiveId(null);
  }, [isOpenControlled, isSearchControlled, onOpenChange]);

  const moveActive = useCallback(
    (delta: number): void => {
      const count: number = navigableIds.length;
      if (count === 0) {
        setRawActiveId(null);
        return;
      }
      // With nothing highlighted (e.g. empty-query open), the first Arrow press
      // lands on the first option (ArrowDown) or last (ArrowUp). Otherwise step
      // from the current highlight, wrapping at the ends.
      const currentIndex: number = activeId !== null ? navigableIds.indexOf(activeId) : -1;
      const nextIndex: number =
        currentIndex === -1
          ? delta > 0
            ? 0
            : count - 1
          : (currentIndex + delta + count) % count;
      setRawActiveId(navigableIds[nextIndex] ?? null);
    },
    [navigableIds, activeId],
  );

  const activate = useCallback(
    (targetId?: string): void => {
      const resolvedId: string | null = targetId ?? activeId;
      if (resolvedId === null) return;
      const entry: CommandPaletteEntry | undefined = entriesRef.current.get(resolvedId);
      if (entry === undefined || entry.disabled) return;
      entry.onSelect?.();
      onSelect?.(resolvedId);
      if (closeOnSelect) close();
    },
    [activeId, onSelect, closeOnSelect, close],
  );

  const reactId: string = useId();
  const baseId: string = id ?? reactId;
  const listboxId = `${baseId}-listbox`;

  const ctxValue: CommandPaletteContextValue = {
    searchValue,
    setSearchValue,
    registerEntry,
    isItemVisible: (entryId: string) => !queryActive || visibleIds.has(entryId),
    isOwnerVisible: (ownerId: string) => !queryActive || visibleOwners.has(ownerId),
    activeId,
    moveActive,
    activate,
    close,
    isEmpty: queryActive && visibleIds.size === 0,
    listboxId,
    optionId: (entryId: string) => `${baseId}-opt-${entryId}`,
  };

  // Partition the search slot (it sits above the listbox; a combobox must not
  // live inside its own listbox) from the option slots (cards + groups).
  // `flattenSlots` descends `<>…</>` fragments because `Children.toArray` does
  // not — a consumer that wraps the slots in a fragment (e.g. a render helper
  // returning `<>…</>`) would otherwise hide the search inside one opaque child.
  const childArray: ReactNode[] = flattenSlots(children);
  const searchSlot: ReactNode = childArray.find(
    (child: ReactNode) => isValidElement(child) && child.type === CommandPaletteSearch,
  );
  const optionSlots: ReactNode[] = childArray.filter(
    (child: ReactNode) => !(isValidElement(child) && child.type === CommandPaletteSearch),
  );

  const frame: ReactNode = (
    <CommandPaletteProvider value={ctxValue}>
      {/* Two stacked `@ux/box` regions with no gap between them: a search box
          whose bottom edge carries the full-width divider, and a results box.
          Each box owns its own padding — the shell adds none. */}
      <div className="airo-input-command-palette">
        <box.div className="airo-input-command-palette__search-box">{searchSlot}</box.div>
        <box.div
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="airo-input-command-palette__results"
        >
          {optionSlots}
          {ctxValue.isEmpty ? (
            <div className="airo-input-command-palette__empty" role="presentation">
              {emptyState ?? 'No results.'}
            </div>
          ) : null}
        </box.div>
      </div>
    </CommandPaletteProvider>
  );

  const anchorRef = useRef<HTMLSpanElement>(null);

  const triggerButton: ReactNode = (
    <span ref={anchorRef} className="airo-input-command-palette__trigger">
      <Button
        {...trigger}
        aria-haspopup={isMobile ? 'dialog' : 'listbox'}
        aria-expanded={isOpen}
        onClick={(event: MouseEvent<HTMLElement>) => {
          trigger.onClick?.(event);
          if (isOpen) close();
          else openPopover();
        }}
      />
    </span>
  );

  if (isMobile) {
    // Command palettes present a chromeless sheet: no visible title and no X.
    // It is dismissed by tapping the scrim or pressing Escape (the drag handle
    // is decorative). The accessible name comes from the trigger (or `aria-label`).
    const sheetAriaLabel: string = trigger['aria-label'] ?? trigger.text ?? ariaLabel;
    return (
      <>
        {triggerButton}
        <BottomSheet
          show={isOpen}
          onClose={close}
          showCloseButton={false}
          aria-label={sheetAriaLabel}
        >
          {frame}
        </BottomSheet>
      </>
    );
  }

  return (
    <>
      {triggerButton}
      {isOpen ? (
        <Flyout
          anchorRef={anchorRef}
          placement={placement}
          onClose={close}
          className="airo-input-command-palette__flyout"
        >
          {frame}
        </Flyout>
      ) : null}
    </>
  );
} as CommandPaletteComponent;

CommandPalette.Search = CommandPaletteSearch;
CommandPalette.Cards = CommandPaletteCards;
CommandPalette.Card = CommandPaletteCard;
CommandPalette.Group = CommandPaletteGroup;
CommandPalette.Item = CommandPaletteItem;
CommandPalette.Muted = CommandPaletteMuted;
