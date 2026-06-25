import { createContext, useContext, useEffect, useRef } from 'react';

// ─── Matching ─────────────────────────────────────────────────────────────

const WHITESPACE = /\s+/g;

/** Lowercase, trim, and collapse internal whitespace to a single space. */
export function normalizeQuery(value: string): string {
  return value.toLowerCase().trim().replace(WHITESPACE, ' ');
}

/**
 * Token-AND substring match: every whitespace-separated token in `query` must
 * appear somewhere in `text`. An empty query matches everything. Used by the
 * root to filter both cards and items from a single search field.
 */
export function matchesQuery(text: string, query: string): boolean {
  const normalizedQuery: string = normalizeQuery(query);
  if (normalizedQuery === '') return true;
  const haystack: string = normalizeQuery(text);
  return normalizedQuery.split(' ').every((token: string) => haystack.includes(token));
}

// ─── Registry entry ─────────────────────────────────────────────────────────

/** A filterable, navigable leaf (a `CommandPalette.Item` or `CommandPalette.Card`). */
export interface CommandPaletteEntry {
  /** Stable id — used as the React key, the option's DOM id suffix, and the activation target. */
  id: string;
  /** Searchable text (label text plus any extra `keywords`). */
  text: string;
  /** Owning container id — a group/cards id, or `'root'` for a leaf rendered directly under `CommandPalette`. */
  ownerId: string;
  /** Disabled leaves stay visible (dimmed) but are skipped by keyboard nav and activation. */
  disabled: boolean;
  /** Selection callback, invoked on click or keyboard activation. */
  onSelect?: () => void;
}

// ─── Root context ───────────────────────────────────────────────────────────

/** Value provided by the `CommandPalette` root to every slot below it. */
export interface CommandPaletteContextValue {
  /** Raw, unnormalized search text — what the `CommandPalette.Search` input displays. */
  searchValue: string;
  /** Update the search text (writes to the root's controlled/uncontrolled state). */
  setSearchValue: (next: string) => void;
  /** Register a leaf in the filter/nav registry; returns its unregister cleanup. */
  registerEntry: (entry: CommandPaletteEntry) => () => void;
  /** Whether a leaf is visible under the current query (always `true` when the query is empty). */
  isItemVisible: (id: string) => boolean;
  /** Whether an owner container has at least one visible child (always `true` when the query is empty). */
  isOwnerVisible: (ownerId: string) => boolean;
  /** Id of the keyboard-highlighted option, or `null` when nothing is navigable. */
  activeId: string | null;
  /** Move the highlight by `delta` positions through the visible, non-disabled options (wraps). */
  moveActive: (delta: number) => void;
  /** Activate a leaf by id (defaults to the current `activeId`): fires its `onSelect` and the root's. */
  activate: (id?: string) => void;
  /** Dismiss the popover (e.g. on Escape from the search field). */
  close: () => void;
  /** `true` when a non-empty query matches no leaf. */
  isEmpty: boolean;
  /** DOM id of the listbox region, for the search input's `aria-controls`. */
  listboxId: string;
  /** Build the DOM id for a leaf's option element (for `aria-activedescendant` and the option's `id`). */
  optionId: (id: string) => string;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export const CommandPaletteProvider = CommandPaletteContext.Provider;

/** Read the `CommandPalette` root context. Throws when used outside a `<CommandPalette>`. */
export function useCommandPaletteContext(): CommandPaletteContextValue {
  const ctx: CommandPaletteContextValue | null = useContext(CommandPaletteContext);
  if (ctx === null) {
    throw new Error('CommandPalette slot components must be rendered inside <CommandPalette>.');
  }
  return ctx;
}

// ─── Owner context ───────────────────────────────────────────────────────────

/**
 * Nearest container id for the leaves below it — `'root'` by default, overridden
 * by `CommandPalette.Group` and `CommandPalette.Cards` for their subtree. Lets a leaf
 * report which container it belongs to so the container can hide itself when
 * none of its children match.
 */
const OwnerContext = createContext<string>('root');

export const OwnerProvider = OwnerContext.Provider;

/** Read the nearest owner container id (`'root'` when not inside a group/cards). */
export function useOwnerId(): string {
  return useContext(OwnerContext);
}

// ─── Leaf hook ───────────────────────────────────────────────────────────────

/** Per-render inputs for {@link useCommandPaletteEntry}. */
export interface CommandPaletteEntryInput {
  id: string;
  text: string;
  disabled: boolean;
  onSelect?: () => void;
}

/** What a leaf needs to render itself: its visibility, highlight, and activation. */
export interface CommandPaletteEntryState {
  /** Render the leaf only when `true` (it self-hides on no match). */
  visible: boolean;
  /** Whether this leaf is the current keyboard-highlight target. */
  active: boolean;
  /** Activate (select) this leaf — wire to the leaf's `onClick`. */
  activate: () => void;
  /** This leaf's option DOM id, for `id` + `aria` wiring. */
  optionId: string;
}

/**
 * Registers a leaf (`CommandPalette.Item` / `CommandPalette.Card`) with the root registry
 * and returns its current `{ visible, active, activate, optionId }`.
 *
 * The entry object is created once and registered on mount (re-registered only
 * if `id` changes); its mutable fields (`text`, `disabled`, `onSelect`,
 * `ownerId`) are refreshed each render without re-registering, so an inline
 * `onSelect` does not thrash the registry.
 */
export function useCommandPaletteEntry(input: CommandPaletteEntryInput): CommandPaletteEntryState {
  const ctx: CommandPaletteContextValue = useCommandPaletteContext();
  const ownerId: string = useOwnerId();

  // Scratch object we own — mutating its fields each render keeps the latest
  // values reachable from the registry without forcing a re-registration.
  const entryRef = useRef<CommandPaletteEntry>({
    id: input.id,
    text: input.text,
    ownerId,
    disabled: input.disabled,
    onSelect: input.onSelect,
  });
  entryRef.current.text = input.text;
  entryRef.current.ownerId = ownerId;
  entryRef.current.disabled = input.disabled;
  entryRef.current.onSelect = input.onSelect;

  const { registerEntry } = ctx;
  useEffect(() => registerEntry(entryRef.current), [registerEntry, input.id]);

  return {
    visible: ctx.isItemVisible(input.id),
    active: ctx.activeId === input.id,
    activate: () => ctx.activate(input.id),
    optionId: ctx.optionId(input.id),
  };
}
