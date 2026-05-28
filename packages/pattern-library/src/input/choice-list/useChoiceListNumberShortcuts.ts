import { type RefObject, createContext, useContext, useEffect, useRef } from 'react';

/**
 * React context published by an "input companion" (most commonly a
 * `PromptBox`) so that any `ChoiceList` rendered as a descendant can
 * automatically scope its `1`–`9` shortcut to that companion's focus
 * target — without the consumer having to wire a ref through props.
 *
 * The provided value is a ref to the focusable element (typically the
 * textarea) the companion exposes. When `ChoiceList` finds a non-null
 * context ref AND the consumer did not pass an explicit
 * `numberKeyShortcuts` object, the hook auto-promotes the listener to
 * `{ listenOn: 'document', scope: contextRef }` so pressing `1`–`9` in
 * the textarea jumps focus into the matching option.
 *
 * Set to `null` (the default) when no companion is present — the
 * shortcut falls back to `'self'` mode and only fires when focus is
 * already inside the ChoiceList.
 */
export const ChoiceListShortcutScopeContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
);

/**
 * Configuration object for `ChoiceList`'s `numberKeyShortcuts` prop.
 *
 * Number-key shortcuts are **on by default** in `'self'` mode — pass an
 * object only when the defaults need overriding (typically because the
 * caller wants `listenOn: 'document'` for a cross-component setup, or
 * `enabled: false` to disable conditionally).
 *
 * When a `ChoiceList` is rendered inside a `PromptBox` (or any other
 * companion that publishes `ChoiceListShortcutScopeContext`), the hook
 * auto-promotes the default to `{ listenOn: 'document', scope: companionRef }`
 * so the shortcut also fires while the user is typing in the textarea.
 * Pass an explicit object to override this auto-wiring.
 */
export interface ChoiceListNumberKeyShortcutsConfig {
  /**
   * Set `false` to disable the shortcut without changing prop shape —
   * useful when the listener is configured at the parent level but the
   * caller wants to flip it on/off.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Where the shortcut applies.
   *
   * - `'self'` (default) — only fires when focus is already inside the
   *   ChoiceList.
   * - `'document'` — superset of `'self'`. Also fires when focus is
   *   inside any of the `scope` refs (e.g. a sibling `PromptBox`
   *   textarea), so Tab-into-list still works after the user lands
   *   focus on an option. Pair with `scope` to avoid hijacking number
   *   keys for the whole page.
   *
   * Both modes attach a single document-level capture listener so the
   * shortcut runs ahead of bubble-phase window handlers (e.g. Storybook's
   * built-in `1`/`2`/`3` navigation shortcuts).
   *
   * @default 'self'
   */
  listenOn?: 'self' | 'document';
  /**
   * When `listenOn: 'document'`, also fire when the keypress target is
   * inside one of these refs (in addition to the ChoiceList surface
   * itself, which always counts in `'document'` mode). Ignored when
   * `listenOn: 'self'`. An empty array (or all-null refs) leaves the
   * surface fallback active — the shortcut still fires when focus is
   * already inside the ChoiceList, but not from anywhere else. Use
   * `enabled: false` (or `numberKeyShortcuts={false}` at the prop
   * level) to disable the shortcut entirely.
   */
  scope?: RefObject<HTMLElement | null> | ReadonlyArray<RefObject<HTMLElement | null>>;
  /**
   * Refs whose subtree always suppresses the shortcut, even if it would
   * otherwise be in `scope`. The ChoiceList's own "Other" text field is
   * always excluded internally — callers do not need to wire it.
   */
  exclude?: RefObject<HTMLElement | null> | ReadonlyArray<RefObject<HTMLElement | null>>;
}

interface UseChoiceListNumberShortcutsArgs {
  surfaceRef: RefObject<HTMLDivElement | null>;
  config: boolean | ChoiceListNumberKeyShortcutsConfig | undefined;
  disabled: boolean;
  selectionMode: 'single' | 'multiple';
}

const OTHER_ROW_SELECTOR =
  '.airo-input-choice-list__other-row, .airo-input-choice-list__multi-row--other';

const SINGLE_OPTION_SELECTOR = '[role="option"]';
const MULTI_OPTION_SELECTOR =
  '.airo-input-choice-list__multi-row:not(.airo-input-choice-list__multi-row--other) input[type="checkbox"]';

function toRefArray(
  refs: RefObject<HTMLElement | null> | ReadonlyArray<RefObject<HTMLElement | null>> | undefined,
): ReadonlyArray<RefObject<HTMLElement | null>> {
  if (refs == null) return [];
  return Array.isArray(refs)
    ? (refs as ReadonlyArray<RefObject<HTMLElement | null>>)
    : [refs as RefObject<HTMLElement | null>];
}

function targetIsInsideAnyRef(
  target: EventTarget | null,
  refs: ReadonlyArray<RefObject<HTMLElement | null>>,
): boolean {
  if (!(target instanceof Node) || refs.length === 0) return false;
  for (const ref of refs) {
    const el = ref.current;
    if (el?.contains(target)) return true;
  }
  return false;
}

function resolveEnabled(config: boolean | ChoiceListNumberKeyShortcutsConfig | undefined): boolean {
  if (config === false) return false;
  if (typeof config === 'object' && config !== null) {
    return config.enabled !== false;
  }
  // `true` and `undefined` (the default) both enable the shortcut.
  return true;
}

function resolveListenOn(
  config: boolean | ChoiceListNumberKeyShortcutsConfig | undefined,
): 'self' | 'document' {
  if (typeof config === 'object' && config !== null) {
    return config.listenOn ?? 'self';
  }
  return 'self';
}

/**
 * Wires up the `1`–`9` keyboard shortcut that focuses (not commits) the
 * Nth option in a `ChoiceList`. Listener attach point and per-event
 * filtering are driven by `config`.
 *
 * Behaviour summary:
 * - `event.repeat`, modifier keys (Ctrl/Cmd/Alt), and keys outside `1`–`9`
 *   are ignored.
 * - The ChoiceList's own "Other" input is always excluded (typing `2`
 *   there means the user wants the digit `2` in their answer).
 * - When N exceeds the number of options, the shortcut is a no-op and
 *   does not call `preventDefault`, so the keystroke can fall through to
 *   whatever input it was meant for.
 * - When N is in range, focus is moved with `preventDefault` +
 *   `stopImmediatePropagation` (so two ChoiceList instances with
 *   overlapping document-scope refs can't both claim the same digit —
 *   the first matching handler wins). Enter/Space still commits; the
 *   user remains in control.
 */
export function useChoiceListNumberShortcuts({
  surfaceRef,
  config,
  disabled,
  selectionMode,
}: UseChoiceListNumberShortcutsArgs): void {
  const enabled = resolveEnabled(config);
  // When the consumer didn't pass an explicit object config, fall back to
  // the companion ref published via context (a `PromptBox` ancestor, etc.).
  // Auto-promote the default `'self'` mode to `'document' + scope: companionRef`
  // so a `ChoiceList` rendered inside a `PromptBox` Just Works — the user can
  // press `1`–`9` while typing in the textarea and focus the matching option.
  const companionScopeRef = useContext(ChoiceListShortcutScopeContext);
  const cfgIsObject = typeof config === 'object' && config !== null;
  const autoPromote = !cfgIsObject && companionScopeRef != null;
  const listenOn = autoPromote ? 'document' : resolveListenOn(config);

  const latestRef = useRef({ config, disabled, selectionMode, companionScopeRef, autoPromote });
  latestRef.current = { config, disabled, selectionMode, companionScopeRef, autoPromote };

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const {
        config: latestConfig,
        disabled: latestDisabled,
        selectionMode: latestMode,
        companionScopeRef: latestCompanionRef,
        autoPromote: latestAutoPromote,
      } = latestRef.current;
      if (latestDisabled) return;
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key;
      if (key.length !== 1 || key < '1' || key > '9') return;

      const surface = surfaceRef.current;
      if (!surface) return;

      const target = event.target;
      const cfgObj =
        typeof latestConfig === 'object' && latestConfig !== null ? latestConfig : null;
      // In auto-promoted mode, the companion ref published via context is
      // the implicit scope. Anything inside the ChoiceList surface is also
      // implicitly in scope (auto-promotion shouldn't downgrade `'self'`-equivalent
      // behaviour when focus is already inside the list).
      const scopeRefs = latestAutoPromote
        ? latestCompanionRef != null
          ? [latestCompanionRef]
          : []
        : toRefArray(cfgObj?.scope);
      const excludeRefs = toRefArray(cfgObj?.exclude);

      if (listenOn === 'document') {
        const inCompanionScope = targetIsInsideAnyRef(target, scopeRefs);
        // `'document'` mode is a superset of `'self'`: it also fires when
        // focus is already inside the ChoiceList surface itself. Without
        // this, explicit `{ listenOn: 'document', scope: someRef }`
        // setups would stop responding to digits the moment the user
        // tabbed into the list — surprising, and inconsistent with the
        // auto-promoted variant which has always behaved this way.
        const inSurfaceFallback = target instanceof Node && surface.contains(target);
        if (!inCompanionScope && !inSurfaceFallback) return;
      } else {
        // `'self'` semantics — fire only when focus is already inside the
        // ChoiceList surface. We attach at `document` on the capture phase
        // (below) so we run before any window-level handler (e.g.
        // Storybook's built-in `1`/`2`/`3` focus shortcuts on the preview
        // iframe), but this scope check keeps the behaviour confined to
        // the ChoiceList.
        if (!(target instanceof Node) || !surface.contains(target)) return;
      }

      if (targetIsInsideAnyRef(target, excludeRefs)) return;

      if (target instanceof Element && target.closest(OTHER_ROW_SELECTOR)) {
        return;
      }

      const optionSelector =
        latestMode === 'multiple' ? MULTI_OPTION_SELECTOR : SINGLE_OPTION_SELECTOR;
      const options = surface.querySelectorAll<HTMLElement>(optionSelector);
      const index = Number(key) - 1;
      if (index >= options.length) return;

      const targetOption = options[index];
      if (!targetOption) return;

      event.preventDefault();
      // Use `stopImmediatePropagation` so that other document-level
      // listeners on the same node — including a second `ChoiceList`
      // with an overlapping `scope` — don't also process this digit.
      // Without it, "last handler wins" decides which option ends up
      // focused; with it, the first matching ChoiceList claims the key.
      event.stopImmediatePropagation();

      // DOM focus moves directly to the option element — the browser's
      // native focus ring follows, and (for single-select) the listbox
      // wrap's capture-phase keydown handler routes subsequent arrow
      // keys via DOM-focus traversal so navigation continues from N
      // rather than the listbox's stale internal active item.
      // Multi-select rows are native checkboxes with roving tabindex;
      // their `onFocus` handler syncs `activeIndex`.
      targetOption.focus();
    };

    // Always attach at `document` on the capture phase. Capture runs before
    // any bubble-phase handler, including ones bound via `window.onkeydown`
    // (Storybook's preview iframe binds `1`/`2`/`3` this way for its own
    // navigation shortcuts). Per-event filters above keep behaviour scoped
    // to either the ChoiceList surface (`'self'`) or the caller-supplied
    // scope refs (`'document'`).
    document.addEventListener('keydown', handleKeyDown as EventListener, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown as EventListener, true);
    };
  }, [enabled, listenOn, surfaceRef]);
}
