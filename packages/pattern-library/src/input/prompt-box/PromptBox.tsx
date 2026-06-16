import Button from '@ux/button';
import CornerActions from '@ux/corner-actions';
import FieldFrame from '@ux/field-frame';
import Flyout from '@ux/flyout';
import AsyncIcon from '@ux/icon/async-icon.js';
import Tag from '@ux/tag';
import TextLockup from '@ux/text-lockup';

import classnames from 'classnames';
import {
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ThinkingIndicator } from '../../primitives/thinking-indicator';
import { ChoiceListShortcutScopeContext } from '../choice-list';
import { LexicalInput, type LexicalInputPopover } from './LexicalInput';

/** A single typeahead suggestion returned by the suggestions service. */
export interface PromptSuggestion {
  /** Unique identifier used as the React key and ARIA option id. */
  id: string;
  /** Text displayed in the suggestions popover. */
  label: string;
  /** Text inserted into the field on acceptance. Defaults to `label` when omitted. */
  value?: string;
}

/**
 * Imperative handle exposed by `PromptBox` via `forwardRef`. Replaces the
 * raw `HTMLTextAreaElement` ref the previous textarea-based implementation
 * exposed; callers that previously called `ref.current.focus()` continue to
 * work, plus the editor now owns mention insertion / removal.
 *
 * The shape is stable across the controlled / uncontrolled split — these
 * methods drive the underlying Lexical editor directly, not React state.
 */
export interface PromptBoxHandle {
  /** Move keyboard focus into the editor surface. */
  focus(): void;
  /** Remove keyboard focus from the editor surface. */
  blur(): void;
  /**
   * Insert an inline element-mention badge at the current selection. The
   * `number` is rendered as `#<number>` and stored verbatim so callers can
   * later remove it by number; `tagName` is mapped to a human-readable
   * label (e.g. `h1` → `Title`).
   */
  insertElementMention(number: number, tagName: string): void;
  /** Remove every element-mention whose stored number matches. */
  removeElementMention(number: number): void;
  /** Remove every element-mention badge from the editor. */
  clearAllElementMentions(): void;
}

const DEFAULT_SUBMIT_LABEL = 'Send';
const DEFAULT_STOP_LABEL = 'Stop';
const DEFAULT_SUGGESTIONS_LABEL = 'Suggestions';
const DEFAULT_TAB_HINT_LABEL = 'tab';
const DEFAULT_COLLAPSE_LABEL = 'Collapse';
const DEFAULT_EXPAND_LABEL = 'Expand';
const defaultSuggestionsStatus = (count: number) =>
  `${count} suggestion${count === 1 ? '' : 's'} available. Use arrow keys to browse or Tab to accept.`;

/**
 * Props for `PromptBox`.
 */
export interface PromptBoxProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onSubmit' | 'children'> {
  /**
   * Controlled value of the text field. When provided the component is
   * fully controlled — the caller is responsible for updating it on every
   * `onChange` call. Omit to use the component in uncontrolled mode with
   * an optional `defaultValue`.
   */
  value?: string;
  /**
   * Initial value when used in uncontrolled mode.
   * @default ""
   */
  defaultValue?: string;
  /** Called on every keystroke with the new field value. */
  onChange?: (value: string) => void;
  /**
   * When `true` the send button is replaced by a Stop button (filled
   * square icon). Clicking Stop fires `onStop` and resets the field.
   * Controlled by the parent — typically set while the AI is generating.
   * @default false
   */
  pending?: boolean;
  /** Disables the field and action button. @default false */
  disabled?: boolean;
  /**
   * When `true`, Enter or the send button fires `onSubmit` even when the
   * trimmed field value is empty. Use when attachments staged outside the
   * field (e.g. chat composer thumbnails) are sufficient to send.
   * @default false
   */
  allowEmptySubmit?: boolean;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
  /**
   * Visual chrome and action layout.
   * - `default` — `@ux/field-frame` border with built-in send/stop; optional **`beforeSubmit`** for extra trailing controls (e.g. mic).
   * - `borderless` — frameless field plus a toolbar with built-in send/stop; optional **`toolbarStart`** and **`beforeSubmit`** for attach / token / mic (see Storybook).
   * @default 'default'
   */
  appearance?: 'default' | 'borderless';
  /**
   * Content rendered **before** the built-in send/stop control.
   * - `default` — inside the field frame’s trailing actions (e.g. microphone `@ux/button`).
   * - `borderless` — inside the toolbar end row, before send/stop (e.g. mic).
   */
  beforeSubmit?: ReactNode;
  /**
   * `appearance="borderless"` only — left side of the toolbar (e.g. attach + token budget buttons).
   * Omit for a minimal composer (field + send only).
   */
  toolbarStart?: ReactNode;
  /**
   * Content rendered in the collapsible expansion panel above the text
   * field (e.g. file-attachment previews, context chips). Omit to hide
   * the panel entirely.
   *
   * The built-in collapse affordance depends on whether you also pass
   * `expansionTitle`:
   *
   * - **With `expansionTitle`** — a header band renders above the
   *   panel in both states, with a chevron toggle that expands AND
   *   collapses. Use this for any case where the user should be able
   *   to re-open the panel from the composer.
   * - **Without `expansionTitle`** — only an inline-end corner
   *   chevron renders, and only inside the panel itself. In
   *   uncontrolled mode it's a one-shot collapse: once the user
   *   clicks it the panel becomes `inert` and the corner button is
   *   no longer reachable. To re-open, drive `expanded` externally
   *   (controlled mode) or supply an `expansionTitle` for a
   *   persistent band toggle.
   */
  expansionContent?: ReactNode;
  /**
   * Controlled expanded state for the expansion panel. When provided the
   * caller is responsible for updating it via `onExpandedChange`. Omit to
   * use the component in uncontrolled mode with an optional `defaultExpanded`.
   *
   * @see {@link PromptBoxProps.defaultExpanded}
   * @see {@link PromptBoxProps.onExpandedChange}
   */
  expanded?: boolean;
  /**
   * Initial expanded state when used in uncontrolled mode.
   * @default false
   *
   * @see {@link PromptBoxProps.expanded}
   * @see {@link PromptBoxProps.onExpandedChange}
   */
  defaultExpanded?: boolean;
  /**
   * Called when the user toggles the expansion panel via the built-in
   * band or corner chevron control. Does **not** fire when the parent
   * component drives a state change by passing a different `expanded`
   * prop — that side of the controlled-mode handshake is owned by the
   * parent and would loop back on itself if echoed here.
   *
   * @see {@link PromptBoxProps.expanded}
   * @see {@link PromptBoxProps.defaultExpanded}
   */
  onExpandedChange?: (expanded: boolean) => void;
  /**
   * Accessible label for the built-in collapse button rendered in the top
   * inline-end corner of the expansion panel. The button calls
   * `onExpandedChange(false)` (and updates internal state when uncontrolled).
   * @default 'Collapse'
   */
  collapseLabel?: string;
  /**
   * Accessible label for the built-in expand button rendered next to the
   * collapsed summary row's title. Only shown when `expansionTitle` is
   * provided and the panel is collapsed.
   * @default 'Expand'
   */
  expandLabel?: string;
  /**
   * Title shown in the **expansion band** above `expansionContent`. The
   * band is visible in both expanded and collapsed states so the staged
   * interaction stays addressable from the composer area; only the
   * content beneath the band animates open / closed. When omitted, no
   * band renders and the collapsed panel disappears entirely
   * (backward-compatible).
   *
   * Typical use: a short label describing the staged interaction
   * (e.g. `"Choose a content type"` for a `ChoiceList`, the secret name
   * for a `SecretsForm`, an in-progress task name for a `Thinker`-style
   * activity panel).
   */
  expansionTitle?: ReactNode;
  /**
   * When `true`, renders a `ThinkingIndicator` next to `expansionTitle`
   * in the expansion band. Use to signal an in-progress task whose
   * details (checklist, timeline, etc.) live in the expanded content.
   * Has no effect unless `expansionTitle` is also set.
   * @default false
   */
  expansionThinking?: boolean;
  /**
   * Called when the user presses Enter (without Shift) or clicks the
   * send button while `pending` is `false`. The trimmed field value is
   * passed as the first argument. The field resets to empty after
   * this fires in uncontrolled mode; in controlled mode the caller is
   * responsible for resetting `value`.
   */
  onSubmit?: (value: string) => void;
  /**
   * Called when the stop button is clicked while `pending` is `true`.
   * The field is reset automatically (both controlled and uncontrolled).
   */
  onStop?: () => void;
  /**
   * **Future — not yet wired to a visible queue button.**
   * When provided and `pending` is `true`, pressing Enter (without Shift)
   * calls this with the trimmed field value so callers can opt in to
   * prompt-queue semantics. While pending, the action button shown in the
   * UI is Stop (not Send), so this callback currently has no dedicated
   * click affordance — it is keyboard-only until a visible Queue button ships.
   */
  onQueue?: (value: string) => void;
  /**
   * Current list of typeahead suggestions from the suggestions service.
   * Pass an empty array (or omit the prop) to hide the suggestions
   * popover. The caller is responsible for fetching and debouncing.
   * @default []
   */
  suggestions?: PromptSuggestion[];
  /**
   * Called on every keystroke so the caller can request updated
   * suggestions from its service. Debounce at the call site — the
   * component fires this on every change event.
   */
  onSuggestionsRequest?: (query: string) => void;
  /**
   * Called when the user selects a suggestion.
   *
   * - `'accept'` — the user pressed Enter on a highlighted suggestion.
   *   The suggestion text is inserted into the field.
   * - `'edit'` — the user pressed Tab. The suggestion text is inserted
   *   and the field retains focus so the user can keep typing.
   */
  onSuggestionAccept?: (suggestion: PromptSuggestion, mode: 'accept' | 'edit') => void;
  /** Accessible label for the send (arrow-up) button. @default "Send" */
  submitLabel?: string;
  /** Accessible label for the stop (square) button. @default "Stop" */
  stopLabel?: string;
  /**
   * Accessible label for the suggestions listbox (read by screen readers
   * when the popover opens). Override for localization.
   * @default "Suggestions"
   */
  suggestionsLabel?: string;
  /**
   * Generates the live-region announcement string read to screen readers
   * when the suggestions popover opens or its count changes. Receives the
   * current suggestion count; return a localized string.
   * @default (n) => `"${n} suggestion(s) available. Use arrow keys to browse or Tab to accept."`
   */
  suggestionsStatus?: (count: number) => string;
  /**
   * Text shown inside the Tab acceptance hint on the active suggestion.
   * Override for localization or capitalization preference.
   * @default "tab"
   */
  tabHintLabel?: string;
  /**
   * When `true`, the editor surface is read-only and paste is suppressed.
   * Use this while a speech-to-text recognizer is actively writing into the
   * field via `value` so the user can't simultaneously edit. Distinct from
   * `disabled`: the field still renders as the active composer (no greyed
   * chrome), it just rejects input.
   * @default false
   */
  isListening?: boolean;
  /**
   * When `true`, the editor is fully read-only — both typing and paste are
   * suppressed. Typically wired to a "token budget exceeded" state where any
   * additional input would be discarded server-side anyway, so silently
   * dropping the input is more honest than accepting it. The visible value
   * is preserved so the user can still see what they typed before hitting
   * the limit.
   * @default false
   */
  isBudgetExceeded?: boolean;
  /**
   * Called when the user pastes text whose length exceeds
   * `maxInlinePasteLength`. The default paste behaviour is suppressed so
   * the caller can stage the content elsewhere (e.g. as an attachment).
   * Omit to accept large text inline like normal.
   */
  onLargePasteDetected?: (content: string) => void;
  /**
   * Character threshold above which a text paste is forwarded to
   * `onLargePasteDetected` instead of being inserted inline.
   * @default 4000
   */
  maxInlinePasteLength?: number;
  /**
   * Called when one or more non-image files are pasted into the editor and
   * `canStageFiles` is `true`. The paste is otherwise suppressed.
   */
  onStageFiles?: (files: File[]) => void;
  /**
   * When `true`, file paste is forwarded to `onStageFiles`. Required gate
   * because attachment limits / file-size policies live with the caller,
   * not the editor.
   * @default false
   */
  canStageFiles?: boolean;
  /**
   * Called when an image is pasted and `canAddAsset` is `true`. Receives a
   * JPEG data URL whose longer edge has been resized to ≤ 1024 px (quality
   * 0.75) so callers can attach it without an extra round-trip.
   */
  onScreenshotCaptured?: (dataUrl: string) => void;
  /**
   * When `true`, image paste is forwarded to `onScreenshotCaptured`.
   * @default false
   */
  canAddAsset?: boolean;
  /**
   * Called on ArrowUp keypress so callers can implement history navigation
   * (e.g. cycle to the previously sent prompt). The argument is `true` when
   * the caret is at the very start of the editor; return `true` to indicate
   * the keypress was consumed (in which case the editor's own caret movement
   * is suppressed). Return `false` to let the editor move the caret normally.
   */
  onArrowUp?: (cursorAtStart: boolean) => boolean;
  /**
   * Called on ArrowDown keypress. The argument is `true` when the caret is
   * at the very end of the editor; return `true` to consume.
   *
   * @see {@link PromptBoxProps.onArrowUp}
   */
  onArrowDown?: (cursorAtEnd: boolean) => boolean;
  /**
   * Called when an element-mention badge disappears from the editor.
   * Receives the mention's stored number so callers can sync external
   * selection state.
   *
   * Detection is diff-based: the editor diffs each document update against
   * the previous tracked-mentions set, so this fires for **any** removal
   * path — ✕-button click, Backspace / Delete keystrokes, programmatic
   * removal via `PromptBoxHandle.removeElementMention()` /
   * `clearAllElementMentions()`, and external `value=""` clears. Callers
   * that want to distinguish user-driven from imperative removals should
   * suppress reentry with a flag at the call site of the imperative
   * methods.
   */
  onMentionRemoved?: (number: number) => void;
}

/**
 * `PromptBox` is the text-input surface for a chat agent drawer. It always
 * includes the **send / stop** control; compose **`beforeSubmit`** and
 * **`toolbarStart`** (borderless) with `@ux/button` or other peers for attach,
 * token budget, microphone, etc.
 *
 * When a typeahead suggestions service is wired up via
 * `onSuggestionsRequest`, a `@ux/flyout` popover appears above the field
 * listing the returned options. Arrow keys navigate the list; Tab accepts
 * the first/active suggestion into the field for further editing; Enter on
 * a highlighted suggestion accepts it; Escape dismisses the list.
 *
 * **Controlled / uncontrolled**: mirrors `@ux/*` conventions — pass
 * `value` + `onChange` for controlled mode, or just `defaultValue` for
 * uncontrolled. In uncontrolled mode the field clears automatically on
 * submit and on stop.
 *
 * @example
 * // Uncontrolled, basic submit
 * <PromptBox
 *   placeholder="Ask anything…"
 *   onSubmit={(text) => sendMessage(text)}
 *   pending={isGenerating}
 *   onStop={() => stopGeneration()}
 * />
 *
 * @example
 * // Borderless — pass `toolbarStart` and `beforeSubmit` (see Storybook **Borderless + toolbar**).
 * <PromptBox appearance="borderless" toolbarStart={…} beforeSubmit={…} onSubmit={send} />
 *
 * @example
 * // With expansion panel (file attachment staging, context chips, etc.).
 * // Controlled — `expanded` is derived from external state, so an
 * // `onExpandedChange` handler is required for the band/corner toggle
 * // to update that state. Without it the built-in chevron click would
 * // dispatch into the void.
 * <PromptBox
 *   expansionContent={<AttachmentPreview files={files} />}
 *   expanded={files.length > 0}
 *   onExpandedChange={(open) => { if (!open) setFiles([]); }}
 *   onSubmit={send}
 * />
 */
function PromptBoxRoot(
  {
    value,
    defaultValue = '',
    onChange,
    pending = false,
    disabled = false,
    allowEmptySubmit = false,
    placeholder,
    appearance = 'default',
    beforeSubmit,
    toolbarStart,
    expansionContent,
    expansionTitle,
    expansionThinking = false,
    expanded,
    defaultExpanded = false,
    onExpandedChange,
    collapseLabel = DEFAULT_COLLAPSE_LABEL,
    expandLabel = DEFAULT_EXPAND_LABEL,
    onSubmit,
    onStop,
    onQueue,
    suggestions = [],
    onSuggestionsRequest,
    onSuggestionAccept,
    submitLabel = DEFAULT_SUBMIT_LABEL,
    stopLabel = DEFAULT_STOP_LABEL,
    suggestionsLabel = DEFAULT_SUGGESTIONS_LABEL,
    suggestionsStatus = defaultSuggestionsStatus,
    tabHintLabel = DEFAULT_TAB_HINT_LABEL,
    isListening = false,
    isBudgetExceeded = false,
    onLargePasteDetected,
    maxInlinePasteLength,
    onStageFiles,
    canStageFiles = false,
    onScreenshotCaptured,
    canAddAsset = false,
    onArrowUp,
    onArrowDown,
    onMentionRemoved,
    className,
    ...rest
  }: PromptBoxProps,
  ref: Ref<PromptBoxHandle>,
) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = isControlled ? (value ?? '') : internalValue;

  // ── Expansion panel ───────────────────────────────────────────────────
  // Controlled when `expanded` is supplied; otherwise uncontrolled with
  // `defaultExpanded` seed. The built-in collapse button (rendered in the
  // panel's top inline-end corner) calls `setExpansionState(false)` which
  // updates internal state when uncontrolled and always fires
  // `onExpandedChange`. Many other things can collapse the panel — picking a
  // ChoiceList option, submitting a form — by toggling the controlled prop.
  const isExpansionControlled = expanded !== undefined;
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isExpanded = isExpansionControlled ? expanded : internalExpanded;
  const hasExpansion = expansionContent != null;

  const setExpansionState = useCallback(
    (next: boolean) => {
      if (!isExpansionControlled) setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [isExpansionControlled, onExpandedChange],
  );

  const [activeIndex, setActiveIndex] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [flyoutSide, setFlyoutSide] = useState<'top' | 'bottom'>('top');

  const fieldFrameRef = useRef<HTMLDivElement>(null);
  const borderlessShellRef = useRef<HTMLDivElement>(null);
  const flyoutAnchorRef = appearance === 'borderless' ? borderlessShellRef : fieldFrameRef;

  // Internal ref to the Lexical editor's imperative handle. Used for
  // post-accept focus restoration and proxied to the forwarded ref via
  // `useImperativeHandle` below so callers can drive mention insertion
  // without PromptBox needing to know the call sites.
  const editorHandleRef = useRef<PromptBoxHandle | null>(null);

  // Mirror of `currentValue` on a ref so command handlers registered inside
  // the Lexical editor read the freshest value at fire time. The Lexical
  // OnChangePlugin → React state → re-render → effect-rebind chain is not
  // synchronous; without this ref a fast typist hitting Enter immediately
  // after a keystroke could submit a stale value. The ref is written from
  // two sites: synchronously in `handleChange` (covers the keystroke→Enter
  // race — if a paint hasn't happened, the effect below hasn't run yet),
  // and from a post-commit effect that catches updates landing through
  // any other path (e.g. controlled-`value` changes from the host).
  const currentValueRef = useRef(currentValue);
  useEffect(() => {
    currentValueRef.current = currentValue;
  }, [currentValue]);

  const listboxId = useId();
  const optionIdPrefix = useId();
  const flyoutId = useId();
  const textEntryId = useId();
  // Stable id for the expansion region so the band/corner toggle buttons
  // can advertise themselves as disclosure controls via `aria-controls` and
  // tie back to the `__expansion-wrap` they show/hide.
  const expansionRegionId = useId();

  // Show the flyout whenever the parent provides suggestions and we are not pending.
  // Always reset activeIndex so aria-activedescendant never points at a stale
  // option id when the suggestions array shrinks between updates.
  useEffect(() => {
    if (suggestions.length > 0 && !pending) {
      setSuggestionsOpen(true);
    } else {
      setSuggestionsOpen(false);
    }
    setActiveIndex(-1);
  }, [suggestions, pending]);

  const showFlyout = suggestionsOpen && suggestions.length > 0;
  const activeOptionId =
    showFlyout && activeIndex >= 0 ? `${optionIdPrefix}-opt-${activeIndex}` : undefined;

  const hasSuggestionFeature = onSuggestionsRequest !== undefined || suggestions.length > 0;

  // Index of the suggestion that Tab will accept: the active one if navigated,
  // otherwise the first suggestion. Used for the Tab hint tag and inline suggestion.
  const tabTargetIndex = activeIndex >= 0 ? activeIndex : 0;

  const inlineSuggestion = useMemo(() => {
    if (!showFlyout || !currentValue) return undefined;
    const target = suggestions[tabTargetIndex];
    if (!target) return undefined;
    const suggestionValue = target.value ?? target.label;
    if (!suggestionValue.toLowerCase().startsWith(currentValue.toLowerCase())) {
      return undefined;
    }
    return currentValue + suggestionValue.slice(currentValue.length);
  }, [showFlyout, currentValue, suggestions, tabTargetIndex]);

  // ── Suggestions ───────────────────────────────────────────────────────

  const acceptSuggestion = useCallback(
    (suggestion: PromptSuggestion, mode: 'accept' | 'edit') => {
      const inserted = suggestion.value ?? suggestion.label;
      if (!isControlled) {
        setInternalValue(inserted);
      }
      onChange?.(inserted);
      onSuggestionAccept?.(suggestion, mode);
      setSuggestionsOpen(false);
      setActiveIndex(-1);
      editorHandleRef.current?.focus();
    },
    [isControlled, onChange, onSuggestionAccept],
  );

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveIndex(-1);
  }, []);

  // ── Submit / Stop ─────────────────────────────────────────────────────

  const handleSubmit = useCallback(() => {
    const trimmed = currentValueRef.current.trim();
    if (disabled || (!trimmed && !allowEmptySubmit)) return;

    if (pending) {
      onQueue?.(trimmed);
      return;
    }

    onSubmit?.(trimmed);
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    if (!isControlled) setInternalValue('');
  }, [allowEmptySubmit, disabled, pending, onQueue, onSubmit, isControlled]);

  const handleStop = useCallback(() => {
    onStop?.();
    setSuggestionsOpen(false);
    setActiveIndex(-1);
    if (isControlled) {
      onChange?.('');
    } else {
      setInternalValue('');
    }
  }, [onStop, isControlled, onChange]);

  // ── Field change ──────────────────────────────────────────────────────

  const handleChange = useCallback(
    (newVal: string) => {
      // Write the freshest value to the ref synchronously so an Enter
      // press fired in the same tick as the keystroke (before React
      // commits / effects flush) reads the new value, not the stale one
      // captured by `currentValueRef.current` from the previous commit.
      currentValueRef.current = newVal;
      if (!isControlled) setInternalValue(newVal);
      onChange?.(newVal);
      if (newVal.trim()) {
        onSuggestionsRequest?.(newVal);
      } else {
        setSuggestionsOpen(false);
      }
    },
    [isControlled, onChange, onSuggestionsRequest],
  );

  // ── Flyout placement tracking ─────────────────────────────────────────

  const handleFlyoutPlacement = useCallback((placement: string) => {
    setFlyoutSide(placement.startsWith('top') ? 'top' : 'bottom');
  }, []);

  // Expose the editor's imperative handle on the forwarded ref. The
  // factory runs once (empty deps) and returns a stable object whose
  // methods delegate through `editorHandleRef.current` at call time —
  // so when the inner Lexical handle remounts (and `editorHandleRef`
  // is re-pointed by `LexicalInput`), the next imperative call picks
  // up the new handle without us having to recompute the outer object.
  useImperativeHandle(
    ref,
    () => ({
      focus() {
        editorHandleRef.current?.focus();
      },
      blur() {
        editorHandleRef.current?.blur();
      },
      insertElementMention(number, tagName) {
        editorHandleRef.current?.insertElementMention(number, tagName);
      },
      removeElementMention(number) {
        editorHandleRef.current?.removeElementMention(number);
      },
      clearAllElementMentions() {
        editorHandleRef.current?.clearAllElementMentions();
      },
    }),
    [],
  );

  // Bundle suggestion-popover state for the editor's keyboard plugin.
  // Omitted entirely when there is no suggestion feature so the plugin
  // skips the popover branches and falls through to history-nav callbacks.
  // Memoized so `KeyboardPlugin`'s effect — which lists `popover` in its
  // deps — doesn't unregister/re-register every command handler on each
  // keystroke (PromptBox re-renders on each `onChange`).
  const popover: LexicalInputPopover | undefined = useMemo(
    () =>
      hasSuggestionFeature
        ? {
            showFlyout,
            activeIndex,
            suggestions,
            acceptSuggestion,
            setActiveIndex,
            closeSuggestions,
          }
        : undefined,
    [
      hasSuggestionFeature,
      showFlyout,
      activeIndex,
      suggestions,
      acceptSuggestion,
      closeSuggestions,
    ],
  );

  const srStatus = showFlyout ? suggestionsStatus(suggestions.length) : '';

  const hasBand = expansionTitle != null;

  const expansionNode = hasExpansion ? (
    <div className="airo-input-prompt-box__expansion-block">
      {/* Header band — visible whenever `expansionTitle` is set, in both
          expanded and collapsed states. Owns the chevron toggle so the
          staged interaction stays addressable from the composer area
          without dominating it. */}
      {hasBand && (
        <div className="airo-input-prompt-box__expansion-band">
          {/* `data-partial="componentAiro"` applied to the leading area
              when the indicator is active — tints both the indicator
              dots and the title under the Airo accent. The chevron
              button stays in the surrounding chrome's neutral palette. */}
          <div
            className="airo-input-prompt-box__expansion-band-leading"
            data-partial={expansionThinking ? 'componentAiro' : undefined}
          >
            {expansionThinking && (
              <ThinkingIndicator
                size={0.75}
                className="airo-input-prompt-box__expansion-band-indicator"
                label={typeof expansionTitle === 'string' ? expansionTitle : 'Working'}
              />
            )}
            {/* `<div>` (not `<span>`) so callers can pass block-level
                content like a `TextLockup` without invalid nesting.
                Strings get wrapped in a `TextLockup size="xs"` so they
                pick up the canonical caption-scale typography for free;
                callers passing their own lockup keep full control. */}
            <div className="airo-input-prompt-box__expansion-band-title">
              {typeof expansionTitle === 'string' ? (
                <TextLockup size="xs" compact title={expansionTitle} />
              ) : (
                expansionTitle
              )}
            </div>
          </div>
          {/* `design="stateless"` (rather than `tertiary`) — UXCore Button
              applies a "pressed/chosen" background to non-stateless designs
              whenever `aria-expanded="true"`, which would make this chevron
              read as a permanent active state for as long as the band is
              open. We still want `aria-expanded` for screen-reader disclosure
              semantics, so we opt out of the visual via the design variant
              instead of dropping the attribute. */}
          <Button
            design="stateless"
            size="small"
            aria-label={isExpanded ? collapseLabel : expandLabel}
            aria-expanded={isExpanded}
            aria-controls={expansionRegionId}
            onClick={() => setExpansionState(!isExpanded)}
            icon={<AsyncIcon icon={isExpanded ? 'chevron-down' : 'chevron-up'} />}
          />
        </div>
      )}
      <div
        id={expansionRegionId}
        className={classnames(
          'airo-input-prompt-box__expansion-wrap',
          isExpanded && 'airo-input-prompt-box__expansion-wrap--open',
        )}
      >
        {/* When the panel is collapsed, `inert` removes every focusable
            descendant (ChoiceList items, SecretsForm fields, etc.) from
            the tab order in addition to hiding them from assistive tech.
            Without this, keyboard users could tab into invisible
            controls clipped to zero height. */}
        <div
          className="airo-input-prompt-box__expansion-inner"
          aria-hidden={!isExpanded}
          // @ts-expect-error — `inert` is supported at runtime; React 18's lib.dom doesn't type it yet.
          inert={!isExpanded ? '' : undefined}
        >
          <div className="airo-input-prompt-box__expansion">
            {/* When no band is rendered the corner action provides the
                only built-in collapse affordance; otherwise the band
                owns it. Note: in uncontrolled mode without a band, the
                corner button is one-way — once collapsed there is no
                built-in path back to expanded (the button itself sits
                inside the collapsed `inert` region). Use
                `expansionTitle` for a persistent band toggle in both
                states, or controlled mode to re-open via external
                state. The JSDoc on the props spells this out. */}
            {!hasBand && (
              <CornerActions space="sm">
                <Button
                  design="tertiary"
                  size="small"
                  aria-label={collapseLabel}
                  aria-expanded={isExpanded}
                  aria-controls={expansionRegionId}
                  onClick={() => setExpansionState(false)}
                  icon={<AsyncIcon icon="chevron-down" />}
                  tabIndex={isExpanded ? 0 : -1}
                />
              </CornerActions>
            )}
            {expansionContent}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const textEntry = (
    <LexicalInput
      ref={editorHandleRef}
      inputId={textEntryId}
      placeholder={placeholder}
      value={currentValue}
      onChange={handleChange}
      onSubmit={handleSubmit}
      disabled={disabled}
      isListening={isListening}
      isBudgetExceeded={isBudgetExceeded}
      canStageFiles={canStageFiles}
      canAddAsset={canAddAsset}
      maxInlinePasteLength={maxInlinePasteLength}
      onLargePasteDetected={onLargePasteDetected}
      onStageFiles={onStageFiles}
      onScreenshotCaptured={onScreenshotCaptured}
      onArrowUp={onArrowUp}
      onArrowDown={onArrowDown}
      onMentionRemoved={onMentionRemoved}
      ghostSuggestion={inlineSuggestion}
      popover={popover}
      className="airo-input-prompt-box__entry"
      {...(hasSuggestionFeature && {
        role: 'combobox',
        'aria-expanded': showFlyout,
        'aria-controls': showFlyout ? listboxId : undefined,
        'aria-autocomplete': 'list' as const,
        'aria-activedescendant': activeOptionId,
      })}
    />
  );

  const primaryActionButton = (
    <span
      className="airo-input-prompt-box__action"
      data-partial={pending ? undefined : 'componentAiro'}
    >
      <Button
        design={pending ? 'critical' : 'primary'}
        size="small"
        icon={<AsyncIcon icon={pending ? 'stop' : 'arrow-up'} />}
        aria-label={pending ? stopLabel : submitLabel}
        onClick={pending ? handleStop : handleSubmit}
        disabled={disabled}
      />
    </span>
  );

  const suggestionsFlyoutNode = showFlyout ? (
    <Flyout
      id={flyoutId}
      anchorRef={flyoutAnchorRef}
      placement="top-start"
      stretch
      onPlacement={handleFlyoutPlacement}
      onClose={() => setSuggestionsOpen(false)}
      className="airo-input-prompt-box__suggestions-flyout"
    >
      <div
        id={listboxId}
        role="listbox"
        aria-label={suggestionsLabel}
        tabIndex={-1}
        className="airo-input-prompt-box__suggestions"
      >
        {suggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            id={`${optionIdPrefix}-opt-${index}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            tabIndex={-1}
            onClick={() => acceptSuggestion(suggestion, 'accept')}
            className={classnames(
              'airo-input-prompt-box__suggestion',
              'airo-input-prompt-box__suggestion-btn',
              {
                'airo-input-prompt-box__suggestion--active': index === activeIndex,
              },
            )}
          >
            {suggestion.label}
            {index === tabTargetIndex && (
              <Tag
                emphasis="passive"
                highcontrast
                size="sm"
                aria-hidden="true"
                className="airo-input-prompt-box__suggestion-tab-hint"
              >
                {tabHintLabel}
              </Tag>
            )}
          </button>
        ))}
      </div>
    </Flyout>
  ) : null;

  return (
    // Publish the editor's outer frame ref so any `ChoiceList` rendered as a
    // descendant (typically inside `expansionContent`) auto-scopes its `1`–`9`
    // shortcut to this composer — pressing a number key while typing inside
    // the editor jumps focus to the matching option without the consumer
    // wiring a ref by hand.
    <ChoiceListShortcutScopeContext.Provider value={flyoutAnchorRef}>
      <div
        {...rest}
        className={classnames(
          'airo-input-prompt-box',
          appearance === 'borderless' && 'airo-input-prompt-box--borderless',
          className,
        )}
      >
        {appearance === 'default' ? (
          <FieldFrame
            ref={fieldFrameRef}
            stretch
            disabled={disabled}
            {...(showFlyout ? { flyoutPlacement: flyoutSide } : {})}
            className="airo-input-prompt-box__frame"
          >
            <div className="airo-input-prompt-box__column">
              {expansionNode}
              <div className="airo-input-prompt-box__field-row">
                {textEntry}
                <span className="airo-input-prompt-box__trailing-actions">
                  {beforeSubmit != null && (
                    <span className="airo-input-prompt-box__before-submit">{beforeSubmit}</span>
                  )}
                  {primaryActionButton}
                </span>
              </div>
            </div>
            {suggestionsFlyoutNode}
          </FieldFrame>
        ) : (
          <>
            <div ref={borderlessShellRef} className="airo-input-prompt-box__input-shell">
              {expansionNode}
              {textEntry}
            </div>
            <div className="airo-input-prompt-box__toolbar">
              <div className="airo-input-prompt-box__toolbar-start">{toolbarStart}</div>
              <div className="airo-input-prompt-box__toolbar-end">
                {beforeSubmit != null && (
                  <span className="airo-input-prompt-box__before-submit">{beforeSubmit}</span>
                )}
                {primaryActionButton}
              </div>
            </div>
            {suggestionsFlyoutNode}
          </>
        )}
        <span
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="airo-input-prompt-box__sr-status"
        >
          {srStatus}
        </span>
      </div>
    </ChoiceListShortcutScopeContext.Provider>
  );
}

/**
 * Public export. `forwardRef` allows callers to focus the textarea
 * programmatically, e.g. to auto-focus the drawer when it opens.
 */
export const PromptBox = forwardRef(PromptBoxRoot);
