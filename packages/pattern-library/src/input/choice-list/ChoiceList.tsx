import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import AsyncIcon from '@ux/icon/async-icon.js';
import Listbox from '@ux/listbox';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';
import classnames from 'classnames';
import {
  Children,
  type Dispatch,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ChoiceListItem, type ChoiceListItemProps } from './ChoiceListItem';
import { ChoiceListItemContent, type ChoiceListItemContentProps } from './ChoiceListItemContent';
import { ChoiceListInlineRowActions, ChoiceListOtherRow } from './ChoiceListOtherRow';
import { ChoiceListStep, type ChoiceListStepProps } from './ChoiceListStep';
import {
  type ChoiceListNumberKeyShortcutsConfig,
  useChoiceListNumberShortcuts,
} from './useChoiceListNumberShortcuts';

export type { ChoiceListNumberKeyShortcutsConfig } from './useChoiceListNumberShortcuts';

export type ChoiceListCommitBehavior = 'immediate' | 'deferred';

const DEFAULT_ARIA_LABEL = 'Choose an option';
/** Default placeholder (and default `aria-label` fallback) for the “other” text field. */
const DEFAULT_OTHER_PLACEHOLDER = 'Type your own';
/** Accessible name for the multi-select “other” checkbox when there is no visible label. */
const DEFAULT_OTHER_CHECKBOX_ARIA_LABEL = 'Enable custom text';

/**
 * Metadata passed to `onDecision` / `onChange` / `onSelect` callbacks.
 * Mirrors the `{ event }` shape that `@ux/listbox#onConfirm` emits so
 * consumers can branch on pointer vs keyboard activation.
 */
export interface ChoiceListDecisionMeta {
  /**
   * The originating UI event — a `KeyboardEvent` when the user confirms
   * with Enter, a `MouseEvent` on click. `null` is reserved for future
   * programmatic activation and is not currently emitted.
   */
  event: ReactKeyboardEvent | ReactMouseEvent | null;
}

/**
 * @deprecated Alias retained for callers still typing against the older
 * `onChange` signature. Prefer {@link ChoiceListDecisionMeta}.
 */
export type ChoiceListChangeMeta = ChoiceListDecisionMeta;

/**
 * Props for the root `ChoiceList` surface.
 */
export interface ChoiceListProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    'onChange' | 'onSelect' | 'title' | 'checked' | 'defaultChecked'
  > {
  /**
   * Accessible name for the menu. The component does not render explanatory
   * copy of its own — the surrounding agent-message component is expected
   * to supply the visible prompt — so every `ChoiceList` needs either this
   * prop, a native `aria-label`, or a native `aria-labelledby` to give the
   * menu a screen-reader name.
   *
   * Precedence at runtime: a native `aria-labelledby` on the root wins
   * first (lets you point at the agent-message id); otherwise `ariaLabel`
   * is used, then a native `aria-label` attribute, then the generic
   * fallback `"Choose an option"`.
   */
  ariaLabel?: string;
  /**
   * Fires once when the user makes a decision — click or Enter on the
   * active single-select option (see `@ux/listbox` keyboard model). In
   * single-step mode this is the main callback. In
   * multi-step mode it fires per-step (use `onComplete` for the final
   * result).
   */
  onDecision?: (value: string, meta: ChoiceListDecisionMeta) => void;
  /**
   * @deprecated Alias for {@link onDecision}.
   */
  onChange?: (value: string, meta: ChoiceListDecisionMeta) => void;
  /**
   * @deprecated Alias for {@link onDecision}. Receives only the value.
   */
  onSelect?: (value: string) => void;
  /**
   * `<ChoiceList.Item>` or `<ChoiceList.Step>` children.
   *
   * - **Item children** — single-step mode (original behavior).
   * - **Step children** — multi-step mode. Each step groups its own Items;
   *   ChoiceList manages step navigation, header, and step indicator
   *   internally.
   */
  children?: ReactNode;
  /**
   * When `true`, keyboard navigation wraps from the last option back to
   * the first and vice versa. Defaults to `false`.
   * @default false
   */
  loop?: boolean;
  /**
   * Optional title rendered inside the card surface above the option list.
   * In single-step mode this adds a header row. In multi-step mode the
   * title comes from each `ChoiceList.Step` and this prop is ignored.
   */
  title?: ReactNode;
  /**
   * 1-based index of the current step. Only visible when both
   * `currentStep` and `totalSteps` are provided alongside `title`.
   * In multi-step mode this is managed internally and ignored.
   */
  currentStep?: number;
  /**
   * Total number of steps. See {@link currentStep}.
   * In multi-step mode this is managed internally and ignored.
   */
  totalSteps?: number;
  /**
   * Fires when the user clicks the close (dismiss) button in the header.
   */
  onClose?: () => void;
  /**
   * Accessible label for the back button in the footer.
   * @default "Previous step"
   */
  backLabel?: string;
  /**
   * Accessible label for the forward button in the footer.
   * @default "Next step"
   */
  forwardLabel?: string;
  /**
   * Override the step indicator text for localization. Receives the
   * current step number and total steps. Defaults to `"1 of 3"`.
   */
  stepIndicatorLabel?: (current: number, total: number) => string;
  /**
   * Accessible label for the close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Label for the skip button shown in the footer on every multi-step
   * step. Clicking skip always records `null` for the current step.
   * @default "Skip"
   */
  skipLabel?: string;
  /**
   * Default selection mode for all steps. Individual steps can override
   * this via their own `selectionMode` prop.
   * @default 'single'
   */
  selectionMode?: 'single' | 'multiple';
  /**
   * Label for the "Continue" button shown on multi-select steps.
   * @default "Continue"
   */
  continueLabel?: string;
  /**
   * Fires after the final step in multi-step mode with a record mapping
   * each step `id` to the chosen value(s). Single-select steps produce
   * a `string`; multi-select steps produce a `string[]`; skipped steps
   * produce `null`.
   */
  onComplete?: (selections: Record<string, string | string[] | null>) => void;
  /**
   * Optional per-step callback in multi-step mode. Fires on every user
   * commit — selection, continue, skip, or forward navigation — before
   * the component advances. Value is `null` when the step is skipped.
   */
  onStepChange?: (stepId: string, value: string | string[] | null) => void;
  /**
   * Optional callback in multi-step mode that fires whenever the active
   * step changes — on initial mount, forward navigation, and back
   * navigation. Use this when the surrounding UI needs to mirror the
   * active step (e.g. a collapsible container hoisting the step title
   * into its own header, where {@link onStepChange} is too narrow because
   * it only fires on forward commit). Fires after the step index has
   * updated.
   */
  onActiveStepChange?: (stepId: string, index: number) => void;
  /**
   * When `true`, draws horizontal separators between options by stacking row
   * borders into one continuous list (single-select listbox buttons and
   * multi-select checkbox rows). Purely visual — no extra landmark elements.
   * @default true
   */
  optionDividers?: boolean;
  /**
   * When `true`, single-select listbox rows show a decorative trailing
   * chevron. Pass `false` for deferred selection surfaces where the row
   * highlights a pending pick rather than implying immediate navigation.
   * @default true
   */
  showOptionChevron?: boolean;
  /**
   * When `true`, single-select rows show a trailing arrow on hover and
   * keyboard focus only (mutually exclusive with always-visible
   * {@link showOptionChevron}).
   * @default false
   */
  showOptionArrowOnHover?: boolean;
  /**
   * When `true`, omits the bottom border on the last row in the option stack
   * (final listbox option or Other row).
   * @default false
   */
  suppressLastRowBottomBorder?: boolean;
  /**
   * Visible label for an inline Skip control on the last row (Other row, or
   * the final listbox option when `allowOther` is false).
   */
  inlineSkipLabel?: string;
  /** Fires when the inline Skip control is activated. */
  onInlineSkip?: () => void;
  /**
   * When `true` with `allowOther`, the Other row shows Skip while the draft
   * is empty and a primary Submit button once the user has typed text.
   * Requires {@link onInlineSkip}.
   * @default false
   */
  inlineSkipOrSubmit?: boolean;
  /** Optional `data-testid` for the inline Submit button on the Other row. */
  otherSubmitTestId?: string;
  /** Optional `data-testid` for the inline Skip control. */
  inlineSkipTestId?: string;
  /** Accessible label for an inline Back control on the last row. */
  inlineBackLabel?: string;
  /** Fires when the inline Back control is activated. */
  onInlineBack?: () => void;
  /** Optional `data-testid` for the inline Back control. */
  inlineBackTestId?: string;
  /**
   * When `true`, shows a freeform “other” path in addition to fixed items.
   * Single-select: `TextEntry` below the listbox (hint text in the placeholder);
   * multi-select: a trailing checkbox row with inline `TextEntry`.
   * @default false
   */
  allowOther?: boolean;
  /**
   * Placeholder for the other `TextEntry` (single- and multi-select). Also
   * used as the field’s default `aria-label` when {@link otherAriaLabel} is omitted.
   * An empty string is treated the same as omitted and falls through to the
   * package default (`"Type your own"`) to prevent an empty accessible name.
   * @default ‘Type your own’
   */
  otherPlaceholder?: string;
  /**
   * Optional `aria-label` on the other `TextEntry` when SR wording should differ from the placeholder.
   * An empty string is treated the same as omitted and falls back to the placeholder.
   */
  otherAriaLabel?: string;
  /**
   * Controlled draft for the single-select "other" field when {@link allowOther}
   * is enabled.
   */
  otherDraft?: string;
  /**
   * Uncontrolled initial other-field draft when {@link allowOther} is enabled.
   */
  defaultOtherDraft?: string;
  /** Fires when the other-field draft changes. */
  onOtherDraftChange?: (value: string) => void;
  /** Fires when the single-select other field receives focus (e.g. to clear a pending chip). */
  onOtherFocus?: () => void;
  /**
   * Accessible label for the inline submit button rendered next to the
   * single-select "other" `TextEntry`. The button is visible whenever
   * `allowOther` is enabled and {@link showOtherSubmitButton} is `true`.
   * It commits the same trimmed-non-empty path as pressing Enter.
   * @default "Submit"
   */
  otherSubmitLabel?: string;
  /**
   * When `false`, hides the inline submit button beside the single-select
   * Other field (for hosts that provide their own commit control).
   * @default true
   */
  showOtherSubmitButton?: boolean;
  /**
   * Accessible name for the multi-select “other” checkbox (there is no visible label).
   * @default 'Enable custom text'
   */
  otherCheckboxAriaLabel?: string;
  /**
   * @deprecated Use {@link otherPlaceholder}. When this is a non-empty plain string
   * and `otherPlaceholder` is omitted, that string is used as the placeholder.
   */
  otherLabel?: ReactNode;
  /**
   * When `true`, the whole `ChoiceList` is non-interactive (`inert` and
   * `aria-disabled` on the root so `...rest` handlers cannot receive stray
   * clicks). Opacity uses **`airo-input-choice-list--disabled`**.
   * Callbacks do not fire.
   * @default false
   */
  disabled?: boolean;
  /**
   * Controls when a single-select pick commits.
   *
   * - **`immediate`** (default) — click or Enter on an option fires
   *   {@link onDecision} right away (original behaviour).
   * - **`deferred`** — click or Enter only updates the pending selection
   *   ({@link selected} / {@link onSelectedChange}). {@link onDecision} fires
   *   when the user clicks Continue in the built-in deferred footer (when
   *   {@link showDeferredFooter} is `true`) or when the consumer commits
   *   externally.
   *
   * Multi-select steps always defer until Continue regardless of this prop.
   *
   * @default 'immediate'
   */
  commitBehavior?: ChoiceListCommitBehavior;
  /**
   * Controlled pending selection when {@link commitBehavior} is `deferred`.
   * Reflected as `aria-selected` on the matching listbox option.
   */
  selected?: string | null;
  /**
   * Uncontrolled initial pending selection when {@link commitBehavior} is
   * `deferred`.
   */
  defaultSelected?: string;
  /**
   * Fires when the pending selection changes in `deferred` mode.
   */
  onSelectedChange?: (value: string | null) => void;
  /**
   * Controlled checked option ids for single-step {@link selectionMode}
   * `"multiple"`. Pair with {@link onCheckedChange} when the host owns
   * commit timing (for example an external Submit footer).
   */
  checked?: string[];
  /**
   * Uncontrolled initial checked ids for single-step multi-select.
   */
  defaultChecked?: string[];
  /** Fires when checked options change in single-step multi-select mode. */
  onCheckedChange?: (values: string[]) => void;
  /**
   * Controlled Other-checkbox state for multi-select {@link allowOther}.
   * Ignored in single-select mode.
   */
  otherChecked?: boolean;
  /**
   * Uncontrolled initial Other-checkbox state for multi-select
   * {@link allowOther}.
   */
  defaultOtherChecked?: boolean;
  /** Fires when the Other checkbox toggles in multi-select mode. */
  onOtherCheckedChange?: (checked: boolean) => void;
  /**
   * When {@link commitBehavior} is `deferred` and the list is single-step
   * single-select, renders Skip + Continue in a footer. Pass `false` when
   * the consumer supplies its own footer chrome. Also suppresses any
   * built-in footer for single-step multi-select.
   * @default true
   */
  showDeferredFooter?: boolean;
  /**
   * Fires when the user clicks Skip in a single-step deferred footer.
   * Ignored when {@link showDeferredFooter} is `false`.
   */
  onSkip?: () => void;
  /**
   * Press `1`–`9` to move keyboard focus to the Nth option (1-indexed).
   * Enter/Space still commits — this only moves focus, matching standard
   * listbox semantics.
   *
   * **On by default**: any `ChoiceList` with focus inside it responds to
   * `1`–`9`. Pass `false` to opt out, or pass an object for
   * cross-component setups — e.g. a `PromptBox` next to the list, where
   * the user is typing in the textarea and should still be able to press
   * `2` to jump to option 2 (`{ listenOn: 'document', scope: ref }`).
   *
   * Number keys never fire when focus is in the `ChoiceList`'s own
   * "Other" text field (the digit reaches the input as typed). Modifier
   * keys (Ctrl/Cmd/Alt) and OS-level key-repeat events are ignored. When
   * `N` exceeds the number of options the keystroke is left alone so it
   * can fall through to whatever input it was meant for.
   *
   * The hook attaches a single document-level capture-phase listener so
   * the shortcut runs ahead of bubble-phase window handlers (e.g.
   * Storybook's built-in `1`/`2`/`3` navigation shortcuts). Per-event
   * scope filters keep behaviour confined to either the ChoiceList
   * surface (`'self'`) or the caller-supplied scope refs (`'document'`).
   *
   * When a `ChoiceListShortcutScopeContext` provider is present in the
   * ancestor tree (a `PromptBox` publishes one for its textarea) and the
   * consumer didn't pass an explicit object config, the default is
   * auto-promoted to `{ listenOn: 'document', scope: companionRef }` so
   * pressing `1`–`9` while typing in the companion focuses the matching
   * option. Pass an explicit object to override the auto-promotion.
   *
   * @default true (on; `'self'` mode standalone, auto-promoted to `'document'` + companion scope when nested under a `ChoiceListShortcutScopeContext` provider such as `PromptBox`)
   */
  numberKeyShortcuts?: boolean | ChoiceListNumberKeyShortcutsConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getIndicator(index: number): string {
  return String(index + 1);
}

interface CollectedItem {
  id: string;
  indicator: string;
  label: ReactNode;
}

function collectItems(children: ReactNode): CollectedItem[] {
  const items: CollectedItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type !== ChoiceListItem) return;
    const props = child.props as ChoiceListItemProps;
    if (!props.value) return;
    items.push({
      id: props.value,
      indicator: props.letter ?? getIndicator(items.length),
      label: props.children,
    });
  });
  return items;
}

interface CollectedStep {
  id: string;
  title: ReactNode;
  ariaLabel?: string;
  selectionMode?: 'single' | 'multiple';
  otherPlaceholder?: string;
  otherAriaLabel?: string;
  children: ReactNode;
}

function collectSteps(children: ReactNode): CollectedStep[] {
  const steps: CollectedStep[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type !== ChoiceListStep) return;
    const props = child.props as ChoiceListStepProps;
    if (!props.id) return;
    steps.push({
      id: props.id,
      title: props.title,
      ariaLabel: props.ariaLabel,
      selectionMode: props.selectionMode,
      otherPlaceholder: props.otherPlaceholder,
      otherAriaLabel: props.otherAriaLabel,
      children: props.children,
    });
  });
  return steps;
}

function hasStepChildren(children: ReactNode): boolean {
  let found = false;
  Children.forEach(children, (child) => {
    if (found) return;
    if (isValidElement(child) && child.type === ChoiceListStep) found = true;
  });
  return found;
}

function renderItemContent(item: CollectedItem): ReactNode {
  if (isValidElement(item.label) && (item.label.type as unknown) === ChoiceListItemContent) {
    const authored = item.label as ReactElement<ChoiceListItemContentProps>;
    return cloneElement(authored, { letter: item.indicator });
  }
  return <ChoiceListItemContent letter={item.indicator} description={item.label} />;
}

/**
 * Build the persisted `string[]` payload for a multi-select step.
 *
 * If the Other text is identical to an already-checked option id (e.g. user
 * checks "blog" *and* types "blog" in Other), the duplicate is dropped so
 * the payload stays set-like — consumers doing simple joins or uniqueness
 * checks would otherwise see `['blog', 'blog']`. This collapses to the same
 * restoration path as the collision documented on
 * {@link restoreMultiSelectFromPersisted}.
 */
function buildMultiSelectValue(
  allowOther: boolean,
  checked: string[],
  otherChecked: boolean,
  otherDraft: string,
): string[] | null {
  const next = [...checked];
  const trimmed = otherDraft.trim();
  if (allowOther && otherChecked && trimmed && !next.includes(trimmed)) next.push(trimmed);
  return next.length > 0 ? next : null;
}

/**
 * When re-opening a multi-select step, split persisted `string[]` into known
 * option ids vs a trailing freeform segment appended by {@link buildMultiSelectValue}.
 *
 * **Collision:** if the user’s custom text is identical to another option’s
 * `value`, it cannot be distinguished from selecting that option; the value is
 * restored as a normal checkbox selection (Other stays empty). Avoid reusing
 * option strings as freeform answers, or accept this limitation until a richer
 * persistence shape exists.
 */
function restoreMultiSelectFromPersisted(
  prev: string[],
  knownIds: ReadonlySet<string>,
  allowOther: boolean,
): { checked: string[]; otherDraft: string; otherChecked: boolean } {
  if (!allowOther) {
    return {
      checked: prev.filter((id) => knownIds.has(id)),
      otherDraft: '',
      otherChecked: false,
    };
  }
  if (prev.length === 0) {
    return { checked: [], otherDraft: '', otherChecked: false };
  }
  const last = prev[prev.length - 1];
  if (last != null && !knownIds.has(last)) {
    return {
      checked: prev.slice(0, -1).filter((id) => knownIds.has(id)),
      otherDraft: last,
      otherChecked: true,
    };
  }
  return {
    checked: prev.filter((id) => knownIds.has(id)),
    otherDraft: '',
    otherChecked: false,
  };
}

function warnDroppedSingleSelectRestore(stepId: string, saved: string, allowOther: boolean) {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(
    `[ChoiceList] Saved single-select value "${saved}" for step "${stepId}" is not in the current option ids` +
      (allowOther ? '; restored as Other text.' : '; selection was cleared.'),
  );
}

/** Decorative chevron at the trailing edge of single-select rows (`aria-hidden`). */
function ChoiceListOptionChevron({ hoverOnly = false }: { hoverOnly?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={classnames(
        'airo-input-choice-list__option-chevron',
        hoverOnly && 'airo-input-choice-list__option-arrow',
      )}
    >
      <AsyncIcon icon={hoverOnly ? 'arrow-right' : 'chevron-right'} width={20} height={20} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HeaderProps {
  title: ReactNode;
  onClose?: () => void;
  closeLabel: string;
  disabled?: boolean;
}

function ChoiceListHeader({ title, onClose, closeLabel, disabled = false }: HeaderProps) {
  return (
    <div className="airo-input-choice-list__header">
      <text.span as="paragraph" className="airo-input-choice-list__title">
        {title}
      </text.span>
      <span className="airo-input-choice-list__nav">
        {onClose ? (
          <Button
            design="stateless"
            size="small"
            aria-label={closeLabel}
            onClick={onClose}
            disabled={disabled}
            icon={<AsyncIcon icon="x" />}
          />
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-select — `@ux/listbox` option buttons (`as="listbox"`)
// ---------------------------------------------------------------------------

interface SingleSelectPanelProps {
  collected: CollectedItem[];
  onConfirm: (value: string, meta: { event: ReactKeyboardEvent | ReactMouseEvent | null }) => void;
  loop: boolean;
  ariaLabel: string;
  ariaLabelledBy?: string;
  selected?: string | null;
  optionDividers: boolean;
  showOptionChevron: boolean;
  showOptionArrowOnHover: boolean;
  suppressLastRowBottomBorder: boolean;
  inlineSkipLabel?: string;
  onInlineSkip?: () => void;
  inlineSkipOrSubmit: boolean;
  otherSubmitTestId?: string;
  inlineSkipTestId?: string;
  inlineBackLabel?: string;
  onInlineBack?: () => void;
  inlineBackTestId?: string;
  disabled?: boolean;
  allowOther?: boolean;
  otherPlaceholder: string;
  otherAriaLabel?: string;
  onOtherSubmit?: (
    value: string,
    event: ReactKeyboardEvent<HTMLInputElement> | ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  /** Accessible label for the inline submit button next to the Other TextEntry. */
  otherSubmitLabel?: string;
  showOtherSubmitButton?: boolean;
  /** Controlled freeform draft when `allowOther` (wizard restore). */
  otherDraft?: string;
  onOtherDraftChange?: (next: string) => void;
  onOtherFocus?: () => void;
}

function ListboxSingleSelectPanel({
  collected,
  onConfirm,
  loop,
  ariaLabel,
  ariaLabelledBy,
  selected,
  optionDividers,
  showOptionChevron,
  showOptionArrowOnHover,
  suppressLastRowBottomBorder,
  inlineSkipLabel,
  onInlineSkip,
  inlineSkipOrSubmit,
  otherSubmitTestId,
  inlineSkipTestId,
  inlineBackLabel,
  onInlineBack,
  inlineBackTestId,
  disabled = false,
  allowOther = false,
  otherPlaceholder,
  otherAriaLabel,
  onOtherSubmit,
  otherSubmitLabel,
  showOtherSubmitButton = true,
  otherDraft,
  onOtherDraftChange,
  onOtherFocus,
}: SingleSelectPanelProps) {
  const showListbox = collected.length > 0;
  const showOther = Boolean(allowOther && onOtherSubmit);
  const lastItemId = collected[collected.length - 1]?.id;
  const showInlineSkipOnLastOption =
    Boolean(inlineSkipLabel && onInlineSkip) && !showOther && !inlineSkipOrSubmit;
  const showInlineActionsOnLastOption =
    !showOther && (showInlineSkipOnLastOption || Boolean(inlineBackLabel && onInlineBack));

  const items = useMemo(
    () =>
      collected.map((item, index) => {
        const isLast = index === collected.length - 1;
        const showInlineActions = isLast && showInlineActionsOnLastOption;
        return {
          id: item.id,
          children: (
            <span className="airo-input-choice-list__option-row-inner">
              <span className="airo-input-choice-list__option-row-body">
                {renderItemContent(item)}
              </span>
              {showOptionChevron ? <ChoiceListOptionChevron /> : null}
              {!showOptionChevron && showOptionArrowOnHover ? (
                <ChoiceListOptionChevron hoverOnly />
              ) : null}
              {showInlineActions ? (
                <ChoiceListInlineRowActions
                  disabled={disabled}
                  inlineBackLabel={inlineBackLabel}
                  onInlineBack={onInlineBack}
                  inlineBackTestId={inlineBackTestId}
                  inlineSkipLabel={showInlineSkipOnLastOption ? inlineSkipLabel : undefined}
                  onInlineSkip={showInlineSkipOnLastOption ? onInlineSkip : undefined}
                  inlineSkipTestId={inlineSkipTestId}
                />
              ) : null}
            </span>
          ),
        };
      }),
    [
      collected,
      disabled,
      inlineBackLabel,
      inlineBackTestId,
      inlineSkipLabel,
      inlineSkipTestId,
      onInlineBack,
      onInlineSkip,
      showInlineActionsOnLastOption,
      showInlineSkipOnLastOption,
      showOptionArrowOnHover,
      showOptionChevron,
    ],
  );

  const [listboxActiveId, setListboxActiveId] = useState<string | null>(selected ?? null);
  useEffect(() => {
    setListboxActiveId(selected ?? null);
  }, [selected]);

  const listboxRef = useRef<HTMLDivElement | null>(null);
  const otherFieldRef = useRef<HTMLInputElement | null>(null);

  const handleListboxKeyDownCapture = useCallback(
    (e: ReactKeyboardEvent) => {
      if (disabled) return;

      // When DOM focus is on an option button (e.g. after the `1`–`9`
      // shortcut moved focus there), `@ux/listbox`'s bubble handler reads
      // its own internal `userActiveItemId` instead of which option is
      // actually focused — so ArrowDown/ArrowUp would jump from the wrong
      // place. Intercept those keys at capture phase and traverse focus
      // among the option buttons directly. The listbox's `onActiveItemChange`
      // callback fires on each option focus and keeps `listboxActiveId`
      // in sync, so a subsequent Tab-out / Tab-in round-trip behaves
      // correctly.
      const target = e.target;
      if (target instanceof HTMLElement && target.matches('[role="option"]')) {
        const isNav =
          e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End';
        if (isNav) {
          const listbox = listboxRef.current;
          if (listbox) {
            const optionEls = Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
            const currentIndex = optionEls.indexOf(target);
            if (currentIndex >= 0 && optionEls.length > 0) {
              // We claim every nav key on a focused option, even when the
              // resolved index is unchanged (Home at first / End at last,
              // or non-looping ArrowUp/Down at a boundary). Without this,
              // the browser's default page-scroll on Arrow / Home / End
              // would fire and break listbox keyboard semantics.
              e.preventDefault();
              e.stopPropagation();
              const lastIndex = optionEls.length - 1;
              let nextIndex = currentIndex;
              if (e.key === 'Home') {
                nextIndex = 0;
              } else if (e.key === 'End') {
                nextIndex = lastIndex;
              } else if (e.key === 'ArrowDown') {
                if (currentIndex < lastIndex) {
                  nextIndex = currentIndex + 1;
                } else if (showOther) {
                  // At the last option: hand off to the Other field.
                  otherFieldRef.current?.focus();
                  return;
                } else if (loop) {
                  nextIndex = 0;
                }
                // else: at boundary, nextIndex stays at currentIndex (no-op move).
              } else if (e.key === 'ArrowUp') {
                if (currentIndex > 0) {
                  nextIndex = currentIndex - 1;
                } else if (loop) {
                  nextIndex = lastIndex;
                }
                // else: at boundary, nextIndex stays at currentIndex.
              }
              const next = optionEls[nextIndex];
              if (next && next !== target) {
                next.focus();
              }
              return;
            }
          }
        }
      }

      // Existing Other-row handoff: when focus is on the listbox container
      // (not on a specific option button) and the listbox's internal active
      // item is the last option, ArrowDown should drop into the Other field.
      if (
        !allowOther ||
        !onOtherSubmit ||
        !showOther ||
        loop ||
        e.key !== 'ArrowDown' ||
        !lastItemId
      ) {
        return;
      }
      const effectiveActive = listboxActiveId ?? selected ?? null;
      if (effectiveActive !== lastItemId) return;
      e.preventDefault();
      e.stopPropagation();
      otherFieldRef.current?.focus();
    },
    [disabled, allowOther, onOtherSubmit, showOther, loop, lastItemId, listboxActiveId, selected],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `collected.length` tracks listbox mount; `ariaLabel*` are the only attributes written here.
  useLayoutEffect(() => {
    const node = listboxRef.current;
    if (!node) return;
    if (ariaLabelledBy) {
      node.setAttribute('aria-labelledby', ariaLabelledBy);
      node.removeAttribute('aria-label');
      return;
    }
    node.setAttribute('aria-label', ariaLabel);
    node.removeAttribute('aria-labelledby');
  }, [ariaLabel, ariaLabelledBy, collected.length]);

  if (!showListbox && !showOther) return null;

  const guardedConfirm = useCallback(
    (value: string, meta: { event: ReactKeyboardEvent | ReactMouseEvent | null }) => {
      if (disabled) return;
      onConfirm(value, meta);
    },
    [disabled, onConfirm],
  );

  const handleOtherArrowUpExit = useCallback(() => {
    listboxRef.current?.focus();
  }, []);

  const showOtherAfterListbox = showOther && showListbox && optionDividers;

  return (
    <div
      className={classnames(
        'airo-input-choice-list__listbox-keyboard-wrap',
        showOtherAfterListbox && 'airo-input-choice-list__listbox-keyboard-wrap--before-other',
      )}
      onKeyDownCapture={showListbox ? handleListboxKeyDownCapture : undefined}
    >
      {showListbox ? (
        <Listbox
          as="listbox"
          stretch
          className={classnames(
            'airo-input-choice-list__listbox',
            optionDividers && 'airo-input-choice-list__listbox--option-dividers',
            showOtherAfterListbox && 'airo-input-choice-list__listbox--before-other',
            suppressLastRowBottomBorder &&
              'airo-input-choice-list__listbox--suppress-last-border',
            !showOptionChevron &&
              !showOptionArrowOnHover &&
              'airo-input-choice-list__listbox--no-chevron',
          )}
          items={items}
          onConfirm={guardedConfirm}
          onActiveItemChange={(id) => {
            setListboxActiveId(id ?? null);
          }}
          loop={loop}
          selected={selected ?? undefined}
          ref={listboxRef}
          tabIndex={disabled ? -1 : 0}
        />
      ) : null}
      {showOther && onOtherSubmit ? (
        <ChoiceListOtherRow
          fieldRef={otherFieldRef}
          otherPlaceholder={otherPlaceholder}
          otherAriaLabel={otherAriaLabel}
          disabled={disabled}
          optionDividers={optionDividers && showListbox}
          suppressBottomBorder={suppressLastRowBottomBorder}
          letter={getIndicator(collected.length)}
          onSubmit={onOtherSubmit}
          submitLabel={otherSubmitLabel}
          showSubmitButton={
            inlineSkipOrSubmit ? false : showOtherSubmitButton
          }
          inlineSkipLabel={inlineSkipLabel}
          onInlineSkip={onInlineSkip}
          inlineSkipOrSubmit={inlineSkipOrSubmit}
          submitTestId={otherSubmitTestId}
          inlineSkipTestId={inlineSkipTestId}
          inlineBackLabel={inlineBackLabel}
          onInlineBack={onInlineBack}
          inlineBackTestId={inlineBackTestId}
          onArrowUpExit={showListbox ? handleOtherArrowUpExit : undefined}
          draft={otherDraft}
          onDraftChange={onOtherDraftChange}
          onOtherFocus={onOtherFocus}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select — native `@ux/checkbox` + row chrome that mirrors listbox
// `design="option"` hover / selected tokens (see `styles.css`).
// ---------------------------------------------------------------------------

interface MultiSelectOptionPanelProps {
  collected: CollectedItem[];
  checked: string[];
  onToggle: (value: string) => void;
  loop: boolean;
  ariaLabel: string;
  ariaLabelledBy?: string;
  optionDividers: boolean;
  disabled?: boolean;
  allowOther?: boolean;
  /** Resolved placeholder string (includes package default when unset). */
  otherPlaceholder: string;
  otherAriaLabel?: string;
  /** Accessible name for the “other” checkbox (no visible label). */
  otherCheckboxAriaLabel: string;
  otherChecked: boolean;
  otherDraft: string;
  onOtherCheckedChange: Dispatch<SetStateAction<boolean>>;
  onOtherDraftChange: Dispatch<SetStateAction<string>>;
  onOtherEnterConfirm?: () => void;
}

function renderCheckboxLabel(item: CollectedItem): ReactNode {
  if (isValidElement(item.label) && (item.label.type as unknown) === ChoiceListItemContent) {
    const authored = item.label as ReactElement<ChoiceListItemContentProps>;
    return cloneElement(authored, { letter: undefined });
  }
  return (
    <text.span as="paragraph" size={-2}>
      {item.label}
    </text.span>
  );
}

function MultiSelectOptionPanel({
  collected,
  checked,
  onToggle,
  loop,
  ariaLabel,
  ariaLabelledBy,
  optionDividers,
  disabled = false,
  allowOther = false,
  otherPlaceholder,
  otherAriaLabel,
  otherCheckboxAriaLabel,
  otherChecked,
  otherDraft,
  onOtherCheckedChange,
  onOtherDraftChange,
  onOtherEnterConfirm,
}: MultiSelectOptionPanelProps) {
  const groupId = useId();
  const otherCheckboxId = `${groupId}-other`;
  const otherFieldId = `${groupId}-other-field`;
  const otherRowIndex = collected.length;
  const totalRows = allowOther ? collected.length + 1 : collected.length;

  const didAutoCheckOtherOnFirstFieldFocus = useRef(false);

  const [activeIndex, setActiveIndex] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (activeIndex >= totalRows) {
      setActiveIndex(Math.max(0, totalRows - 1));
    }
  }, [activeIndex, totalRows]);

  useEffect(() => {
    if (!allowOther) {
      didAutoCheckOtherOnFirstFieldFocus.current = false;
    }
  }, [allowOther]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (disabled || totalRows === 0) return;
      if ((e.target as HTMLElement).closest?.('.airo-input-choice-list__multi-other-entry-wrap')) {
        return;
      }
      const clamped = Math.min(activeIndex, totalRows - 1);
      let next: number;
      if (e.key === 'ArrowDown') {
        next = clamped + 1;
        if (next >= totalRows) next = loop ? 0 : clamped;
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        next = clamped - 1;
        if (next < 0) next = loop ? totalRows - 1 : 0;
        e.preventDefault();
      } else if (e.key === 'Home') {
        next = 0;
        e.preventDefault();
      } else if (e.key === 'End') {
        next = totalRows - 1;
        e.preventDefault();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (clamped < collected.length) {
          const item = collected[clamped];
          if (item) onToggle(item.id);
        } else if (allowOther) {
          onOtherCheckedChange((prev) => !prev);
        }
        e.preventDefault();
        return;
      } else {
        return;
      }
      setActiveIndex(next);
      const input =
        rowRefs.current[next]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      input?.focus();
    },
    [activeIndex, allowOther, collected, disabled, loop, onOtherCheckedChange, onToggle, totalRows],
  );

  const handleOtherTextKeyDown = useCallback<
    KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>
  >(
    (e) => {
      if (e.key !== 'Enter' || disabled) return;
      const trimmed = otherDraft.trim();
      if (!otherChecked || !trimmed) return;
      e.preventDefault();
      e.stopPropagation();
      onOtherEnterConfirm?.();
    },
    [disabled, onOtherEnterConfirm, otherChecked, otherDraft],
  );

  const handleOtherTextFocus = useCallback(() => {
    if (disabled || didAutoCheckOtherOnFirstFieldFocus.current) return;
    didAutoCheckOtherOnFirstFieldFocus.current = true;
    setActiveIndex(otherRowIndex);
    if (!otherChecked) {
      onOtherCheckedChange(true);
    }
  }, [disabled, onOtherCheckedChange, otherChecked, otherRowIndex]);

  if (collected.length === 0 && !allowOther) return null;

  return (
    <fieldset
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      tabIndex={-1}
      className={classnames(
        'airo-input-choice-list__multi-option-list',
        optionDividers && 'airo-input-choice-list__multi-option-list--option-dividers',
      )}
      onKeyDown={handleKeyDown}
    >
      {collected.map((item, i) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Pointer hit-area only — keyboard uses roving `tabIndex` on each checkbox input inside the fieldset.
        <div
          key={item.id}
          className="airo-input-choice-list__multi-row"
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          onClick={(e) => {
            if (disabled) return;
            const target = e.target as HTMLElement;
            if (target.closest('label') || target.closest('input[type="checkbox"]')) return;
            const input =
              rowRefs.current[i]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
            if (!input || input.disabled) return;
            input.focus({ preventScroll: true });
            input.click();
          }}
        >
          <Checkbox
            id={`${groupId}-${i}`}
            name={groupId}
            checked={checked.includes(item.id)}
            disabled={disabled}
            onChange={() => {
              setActiveIndex(i);
              onToggle(item.id);
            }}
            onFocus={() => {
              setActiveIndex((prev) => (prev === i ? prev : i));
            }}
            label={renderCheckboxLabel(item)}
            tabIndex={i === activeIndex ? 0 : -1}
          />
        </div>
      ))}
      {allowOther ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Pointer hit-area only — keyboard uses roving `tabIndex` on the other checkbox.
        <div
          key="__other__"
          className={classnames(
            'airo-input-choice-list__multi-row',
            'airo-input-choice-list__multi-row--other',
          )}
          ref={(el) => {
            rowRefs.current[otherRowIndex] = el;
          }}
          onClick={(e) => {
            if (disabled) return;
            const target = e.target as HTMLElement;
            if (
              target.closest('label') ||
              target.closest('input[type="checkbox"]') ||
              target.closest('.ux-text-entry-shell') ||
              target.closest('textarea') ||
              target.closest('input:not([type="checkbox"])')
            ) {
              return;
            }
            const input =
              rowRefs.current[otherRowIndex]?.querySelector<HTMLInputElement>(
                'input[type="checkbox"]',
              );
            if (!input || input.disabled) return;
            input.focus({ preventScroll: true });
            input.click();
          }}
        >
          <div className="airo-input-choice-list__multi-other-inner">
            <Checkbox
              id={otherCheckboxId}
              name={`${groupId}-other`}
              checked={otherChecked}
              disabled={disabled}
              onChange={(checked: boolean) => {
                setActiveIndex(otherRowIndex);
                onOtherCheckedChange(checked);
              }}
              aria-label={otherCheckboxAriaLabel}
              tabIndex={otherRowIndex === activeIndex ? 0 : -1}
            />
            <span className="airo-input-choice-list__multi-other-entry-wrap">
              <TextEntry
                id={otherFieldId}
                multiline={false}
                stretch
                visualSize="sm"
                value={otherDraft}
                onChange={(v: string | number) => {
                  onOtherDraftChange(String(v));
                }}
                onFocus={handleOtherTextFocus}
                onKeyDown={handleOtherTextKeyDown}
                disabled={disabled}
                placeholder={otherPlaceholder}
                className="airo-input-choice-list__multi-other-entry"
                aria-label={otherAriaLabel ?? otherPlaceholder}
              />
            </span>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Footer — back / step indicator / forward navigation (multi-step), skip
// button (always in multi-step), and continue button (multi-select only).
// Always rendered in multi-step mode so the chrome doesn't shift between
// steps; returns null in single-step mode.
// ---------------------------------------------------------------------------

interface ChoiceListFooterProps {
  currentStep?: number;
  totalSteps?: number;
  stepIndicatorLabel?: (current: number, total: number) => string;
  onBack?: () => void;
  onForward?: () => void;
  backLabel: string;
  forwardLabel: string;
  skipLabel: string;
  onSkip: () => void;
  continueLabel?: string;
  onContinue?: () => void;
  continueDisabled?: boolean;
  disabled?: boolean;
}

function ChoiceListFooter({
  currentStep,
  totalSteps,
  stepIndicatorLabel,
  onBack,
  onForward,
  backLabel,
  forwardLabel,
  skipLabel,
  onSkip,
  continueLabel,
  onContinue,
  continueDisabled = false,
  disabled = false,
}: ChoiceListFooterProps) {
  const hasStepIndicator = currentStep != null && totalSteps != null && totalSteps > 1;
  const isLastStep = currentStep != null && totalSteps != null && currentStep >= totalSteps;

  return (
    <div className="airo-input-choice-list__footer">
      {hasStepIndicator ? (
        <span className="airo-input-choice-list__footer-nav">
          {onBack ? (
            <Button
              design="inline"
              size="small"
              aria-label={backLabel}
              disabled={disabled || currentStep === 1}
              onClick={onBack}
              icon={<AsyncIcon icon="chevron-left" />}
            />
          ) : null}
          <text.span
            as="caption"
            size={-2}
            emphasis="passive"
            className="airo-input-choice-list__step-indicator"
          >
            {stepIndicatorLabel && currentStep != null && totalSteps != null
              ? stepIndicatorLabel(currentStep, totalSteps)
              : `${currentStep} of ${totalSteps}`}
          </text.span>
          {onForward && !isLastStep ? (
            <Button
              design="inline"
              size="small"
              aria-label={forwardLabel}
              disabled={disabled}
              onClick={onForward}
              icon={<AsyncIcon icon="chevron-right" />}
            />
          ) : null}
        </span>
      ) : null}
      <span className="airo-input-choice-list__footer-actions">
        <Button
          design="control"
          size="small"
          type="button"
          text={skipLabel}
          disabled={disabled}
          onClick={onSkip}
        />
        {onContinue ? (
          <Button
            design="primary"
            size="small"
            type="button"
            aria-label={continueLabel}
            disabled={disabled || continueDisabled}
            icon={<AsyncIcon icon="arrow-right" />}
            onClick={onContinue}
          />
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

/**
 * Wrapper for a single multi-step panel that owns its slide-in animation.
 *
 * The enter class is decided **once, at mount** (via the `useState`
 * initializer) and never recomputed. This matters because the slot is keyed
 * by step id: navigating forward/back remounts it (so `animateOnMount` is read
 * fresh and the slide plays), while a same-step parent re-render keeps it
 * mounted. If the enter class were derived from a prop/ref read on every
 * render, flipping that value mid-life would add the `animation` property to a
 * live element and replay (or truncate) the slide. Capturing it at mount makes
 * the animation a pure function of the mount event.
 */
function MultiStepSlot({
  direction,
  animateOnMount,
  children,
}: {
  direction: 'forward' | 'back';
  animateOnMount: boolean;
  children: ReactNode;
}) {
  const [enterClass] = useState<string | null>(() =>
    animateOnMount
      ? direction === 'forward'
        ? 'airo-input-choice-list__step--enter-forward'
        : 'airo-input-choice-list__step--enter-back'
      : null,
  );
  return <div className={classnames('airo-input-choice-list__step', enterClass)}>{children}</div>;
}

/**
 * `ChoiceList` renders an AI-generated set of options for the user to pick
 * from. Option rows render without card chrome — the consumer owns the outer
 * surface. Single-select steps use **`@ux/listbox`** **`as="listbox"`** with
 * stretched **`design="option"`** buttons and a trailing chevron.
 *
 * **Single-step mode** — pass `<ChoiceList.Item>` children directly:
 *
 * @example
 * <ChoiceList ariaLabel="Pick a direction" onDecision={(v) => send(v)}>
 *   <ChoiceList.Item value="landing">Build a landing page</ChoiceList.Item>
 *   <ChoiceList.Item value="campaign">Launch a campaign</ChoiceList.Item>
 * </ChoiceList>
 *
 * **Multi-step mode** — pass `<ChoiceList.Step>` children. The component
 * manages step navigation, header titles, and the step indicator
 * automatically:
 *
 * @example
 * <ChoiceList onComplete={(sel) => sendToAgent(sel)} onClose={dismiss}>
 *   <ChoiceList.Step id="style" title="What style do you prefer?">
 *     <ChoiceList.Item value="modern">Modern</ChoiceList.Item>
 *     <ChoiceList.Item value="classic">Classic</ChoiceList.Item>
 *   </ChoiceList.Step>
 *   <ChoiceList.Step id="color" title="Pick a color palette">
 *     <ChoiceList.Item value="warm">Warm and Bold</ChoiceList.Item>
 *     <ChoiceList.Item value="cool">Cool and Calm</ChoiceList.Item>
 *   </ChoiceList.Step>
 * </ChoiceList>
 */
function ChoiceListRoot({
  ariaLabel,
  'aria-label': ariaLabelAttribute,
  'aria-labelledby': ariaLabelledByAttribute,
  onDecision,
  onChange,
  onSelect,
  children,
  className,
  loop = false,
  title,
  currentStep,
  totalSteps,
  onClose,
  backLabel = 'Previous step',
  forwardLabel = 'Next step',
  stepIndicatorLabel,
  closeLabel = 'Close',
  skipLabel = 'Skip',
  selectionMode: rootSelectionMode,
  continueLabel = 'Continue',
  onComplete,
  onStepChange,
  onActiveStepChange,
  optionDividers = true,
  showOptionChevron = true,
  showOptionArrowOnHover = false,
  suppressLastRowBottomBorder = false,
  inlineSkipLabel,
  onInlineSkip,
  inlineSkipOrSubmit = false,
  otherSubmitTestId,
  inlineSkipTestId,
  inlineBackLabel,
  onInlineBack,
  inlineBackTestId,
  allowOther = false,
  otherLabel: otherLabelProp,
  otherPlaceholder,
  otherAriaLabel,
  otherDraft: otherDraftProp,
  defaultOtherDraft,
  onOtherDraftChange,
  onOtherFocus,
  otherSubmitLabel = 'Submit',
  showOtherSubmitButton = true,
  otherCheckboxAriaLabel,
  disabled = false,
  commitBehavior = 'immediate',
  selected: selectedProp,
  defaultSelected,
  onSelectedChange,
  checked: checkedProp,
  defaultChecked,
  onCheckedChange,
  otherChecked: otherCheckedProp,
  defaultOtherChecked,
  onOtherCheckedChange,
  showDeferredFooter = true,
  onSkip,
  numberKeyShortcuts,
  ...rest
}: ChoiceListProps) {
  // Absorb the removed `variant` prop so legacy callers (JS or via `any`)
  // don't accidentally forward it to the root <div>. The cast is intentionally
  // local so `variant` does not appear in the exported ChoiceListProps type.
  const { variant: _variant, ...safeRest } = rest as typeof rest & { variant?: unknown };
  const effectiveOtherPlaceholder =
    (otherPlaceholder || undefined) ??
    (typeof otherLabelProp === 'string' && otherLabelProp ? otherLabelProp : undefined) ??
    DEFAULT_OTHER_PLACEHOLDER;
  const effectiveOtherCheckboxAriaLabel =
    otherCheckboxAriaLabel ?? DEFAULT_OTHER_CHECKBOX_ARIA_LABEL;
  const otherLabelDeprecationWarnedRef = useRef(false);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    if (otherLabelDeprecationWarnedRef.current) return;
    if (
      typeof otherLabelProp === 'string' &&
      otherLabelProp.length > 0 &&
      otherPlaceholder === undefined
    ) {
      otherLabelDeprecationWarnedRef.current = true;
      console.warn(
        '[@airo-ux/pattern-library ChoiceList] `otherLabel` is deprecated; use `otherPlaceholder` instead.',
      );
    }
  }, [otherLabelProp, otherPlaceholder]);
  const isMultiStep = useMemo(() => hasStepChildren(children), [children]);
  const steps = useMemo(() => (isMultiStep ? collectSteps(children) : []), [isMultiStep, children]);
  const isDeferred = commitBehavior === 'deferred';

  // -- Deferred single-select pending state --
  const [internalPending, setInternalPending] = useState<string | null>(defaultSelected ?? null);
  const pendingValue = selectedProp !== undefined ? selectedProp : internalPending;
  const setPendingValue = useCallback(
    (next: string | null) => {
      if (selectedProp === undefined) {
        setInternalPending(next);
      }
      onSelectedChange?.(next);
    },
    [onSelectedChange, selectedProp],
  );

  // -- Multi-step state --
  const [stepIndex, setStepIndex] = useState(0);
  const selectionsRef = useRef<Record<string, string | string[] | null>>({});
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  // The per-step slide animation represents a step *transition* (forward/back),
  // so it must not play on the choicelist's first appearance. Otherwise a
  // surface that mounts directly into a multi-step ChoiceList — e.g. an
  // askQuestion swapped into an input slot, where the slot already animates a
  // vertical reveal — slides in sideways on top of that reveal, reading as a
  // diagonal "from the corner" entrance instead of a clean full-width one.
  // Tracks whether a step has been rendered yet; only navigation triggers the
  // slide. Resets to false on remount (a fresh swap-in), so re-entry is clean.
  const hasRenderedStepRef = useRef(false);
  const [multiChecked, setMultiChecked] = useState<string[]>([]);
  const [singleStepMultiChecked, setSingleStepMultiChecked] = useState<string[]>(defaultChecked ?? []);
  const [singleStepOtherChecked, setSingleStepOtherChecked] = useState(defaultOtherChecked ?? false);
  const [internalOtherDraft, setInternalOtherDraft] = useState(defaultOtherDraft ?? '');
  const otherDraft = otherDraftProp !== undefined ? otherDraftProp : internalOtherDraft;
  const writeOtherDraft = useCallback(
    (next: SetStateAction<string>) => {
      if (otherDraftProp === undefined) {
        setInternalOtherDraft((prev) => {
          const resolved = typeof next === 'function' ? next(prev) : next;
          onOtherDraftChange?.(resolved);
          return resolved;
        });
        return;
      }
      const resolved = typeof next === 'function' ? next(otherDraftProp) : next;
      onOtherDraftChange?.(resolved);
    },
    [onOtherDraftChange, otherDraftProp],
  );
  const [otherChecked, setOtherChecked] = useState(false);

  const effectiveMultiChecked = isMultiStep
    ? multiChecked
    : checkedProp !== undefined
      ? checkedProp
      : singleStepMultiChecked;

  const effectiveOtherChecked = isMultiStep
    ? otherChecked
    : otherCheckedProp !== undefined
      ? otherCheckedProp
      : singleStepOtherChecked;

  const writeMultiChecked = useCallback(
    (updater: string[] | ((prev: string[]) => string[])) => {
      const prev = isMultiStep
        ? multiChecked
        : checkedProp !== undefined
          ? checkedProp
          : singleStepMultiChecked;
      const resolved = typeof updater === 'function' ? updater(prev) : updater;
      if (isMultiStep) {
        setMultiChecked(resolved);
      } else if (checkedProp === undefined) {
        setSingleStepMultiChecked(resolved);
      }
      onCheckedChange?.(resolved);
    },
    [checkedProp, isMultiStep, multiChecked, onCheckedChange, singleStepMultiChecked],
  );

  const writeOtherChecked = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const prev = isMultiStep
        ? otherChecked
        : otherCheckedProp !== undefined
          ? otherCheckedProp
          : singleStepOtherChecked;
      const resolved = typeof updater === 'function' ? updater(prev) : updater;
      if (isMultiStep) {
        setOtherChecked(resolved);
      } else if (otherCheckedProp === undefined) {
        setSingleStepOtherChecked(resolved);
      }
      onOtherCheckedChange?.(resolved);
    },
    [isMultiStep, onOtherCheckedChange, otherChecked, otherCheckedProp, singleStepOtherChecked],
  );

  useEffect(() => {
    if (isMultiStep && steps.length > 0 && stepIndex >= steps.length) {
      setStepIndex(steps.length - 1);
    }
  }, [isMultiStep, steps.length, stepIndex]);

  const activeStep = isMultiStep ? steps[stepIndex] : undefined;
  const stepTotalSteps = steps.length;
  // Use the primitive id (not the step object) as an effect dep — the parent
  // recreates <ChoiceList.Step> JSX on every render, so `activeStep` takes a
  // fresh object identity each time and would otherwise re-fire dependent
  // effects on every parent re-render and wipe in-progress edits.
  const activeStepId = activeStep?.id;
  const activeSelectionMode = activeStep?.selectionMode ?? rootSelectionMode ?? 'single';
  const isMultiSelect = activeSelectionMode === 'multiple';

  // Per-step Other overrides fall through to root-level props, which in turn
  // fall through to the package defaults resolved above.
  const activeOtherPlaceholder =
    (activeStep?.otherPlaceholder || undefined) ?? effectiveOtherPlaceholder;
  const activeOtherAriaLabel =
    (activeStep?.otherAriaLabel || undefined) ?? (otherAriaLabel || undefined);

  // Collect items from the appropriate source
  const itemChildren = isMultiStep ? activeStep?.children : children;
  const collected = useMemo(() => collectItems(itemChildren), [itemChildren]);
  // Stable string fingerprint of the active step's item ids. Used as an effect
  // dep so the restore effect re-runs only when the actual id set changes, not
  // every time the parent re-renders and produces a new `collected` array.
  // Use JSON.stringify so the fingerprint is unambiguous regardless of
  // characters in user-supplied `ChoiceListItem.value` ids (spaces, commas,
  // pipes are all legal in React `value` strings).
  const collectedIdsKey = useMemo(() => JSON.stringify(collected.map((c) => c.id)), [collected]);

  // Restore multi-select + optional Other row, or single-select Other draft, when the wizard step changes.
  // Deps reference primitives (`activeStepId`, `collectedIdsKey`) instead of
  // the `activeStep` / `collected` references, which take fresh identity on
  // every parent re-render. Without this, a parent re-render mid-edit on a
  // multi-select step would re-run the effect, hit the `else` branch (because
  // `selectionsRef.current[activeStep.id]` is undefined until Forward), and
  // wipe `multiChecked` to `[]`. The closure still reads the latest
  // `activeStep` / `collected` from the render where the effect last fired.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    if (!isMultiStep || !activeStep) return;
    const prev = selectionsRef.current[activeStep.id];
    const knownIds = new Set(collected.map((c) => c.id));

    if (isMultiSelect) {
      if (Array.isArray(prev)) {
        if (allowOther) {
          const restored = restoreMultiSelectFromPersisted(prev, knownIds, true);
          setMultiChecked(restored.checked);
          writeOtherDraft(restored.otherDraft);
          setOtherChecked(restored.otherChecked);
        } else {
          setMultiChecked(prev.filter((id) => knownIds.has(id)));
          writeOtherDraft('');
          setOtherChecked(false);
        }
      } else {
        setMultiChecked([]);
        writeOtherDraft('');
        setOtherChecked(false);
      }
      return;
    }

    setMultiChecked([]);
    if (allowOther && typeof prev === 'string' && prev.length > 0 && !knownIds.has(prev)) {
      writeOtherDraft(prev);
      setOtherChecked(false);
      warnDroppedSingleSelectRestore(activeStep.id, prev, true);
    } else if (typeof prev === 'string' && prev.length > 0 && !knownIds.has(prev)) {
      writeOtherDraft('');
      setOtherChecked(false);
      warnDroppedSingleSelectRestore(activeStep.id, prev, false);
    } else {
      writeOtherDraft('');
      setOtherChecked(false);
    }
  }, [isMultiStep, activeStepId, isMultiSelect, allowOther, collectedIdsKey]);

  // -- Resolve header/footer props --
  const effectiveTitle = isMultiStep ? activeStep?.title : title;
  const effectiveCurrentStep = isMultiStep ? stepIndex + 1 : currentStep;
  const effectiveTotalSteps = isMultiStep ? stepTotalSteps : totalSteps;

  const effectiveOnBack = isMultiStep
    ? () => {
        if (disabled) return;
        setDirection('back');
        setStepIndex((i) => Math.max(0, i - 1));
      }
    : undefined;

  const effectiveOnForward = isMultiStep
    ? () => {
        if (disabled || !activeStep) return;
        if (isMultiSelect) {
          const value = buildMultiSelectValue(allowOther, multiChecked, otherChecked, otherDraft);
          selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: value };
          onStepChange?.(activeStep.id, value);
          setMultiChecked([]);
          writeOtherDraft('');
          setOtherChecked(false);
        } else if (selectionsRef.current[activeStep.id] == null) {
          selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: null };
          onStepChange?.(activeStep.id, null);
        }
        setDirection('forward');
        setStepIndex((i) => Math.min(stepTotalSteps - 1, i + 1));
      }
    : undefined;

  // -- Callbacks --
  const handleSelectOnly = useCallback(
    (nextValue: string) => {
      if (disabled) return;
      writeOtherDraft('');
      setOtherChecked(false);
      setPendingValue(nextValue);
    },
    [disabled, setPendingValue],
  );

  const handleConfirm = useCallback(
    (nextValue: string, meta: { event: ReactKeyboardEvent | ReactMouseEvent | null }) => {
      if (disabled) return;
      writeOtherDraft('');
      setOtherChecked(false);
      onDecision?.(nextValue, { event: meta.event });
      onChange?.(nextValue, { event: meta.event });
      onSelect?.(nextValue);

      if (isMultiStep && activeStep) {
        selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: nextValue };
        onStepChange?.(activeStep.id, nextValue);

        if (stepIndex < stepTotalSteps - 1) {
          setDirection('forward');
          setStepIndex((i) => i + 1);
        } else {
          onComplete?.(selectionsRef.current);
        }
      }
    },
    [
      disabled,
      onDecision,
      onChange,
      onSelect,
      isMultiStep,
      activeStep,
      stepIndex,
      stepTotalSteps,
      onStepChange,
      onComplete,
    ],
  );

  const handleListboxActivate = useCallback(
    (nextValue: string, meta: { event: ReactKeyboardEvent | ReactMouseEvent | null }) => {
      if (disabled) return;
      if (isDeferred && !isMultiSelect) {
        handleSelectOnly(nextValue);
        return;
      }
      handleConfirm(nextValue, meta);
    },
    [disabled, handleConfirm, handleSelectOnly, isDeferred, isMultiSelect],
  );

  const resolveDeferredCommitValue = useCallback((): string | null => {
    if (pendingValue) return pendingValue;
    if (allowOther && otherDraft.trim()) return otherDraft.trim();
    return null;
  }, [allowOther, otherDraft, pendingValue]);

  const handleDeferredContinue = useCallback(() => {
    if (disabled || !isDeferred || isMultiSelect) return;
    const value = resolveDeferredCommitValue();
    if (!value) return;
    handleConfirm(value, { event: null });
  }, [disabled, handleConfirm, isDeferred, isMultiSelect, resolveDeferredCommitValue]);

  const handleDeferredMultiStepContinue = useCallback(() => {
    if (disabled || !isMultiStep || !activeStep || isMultiSelect) return;
    const value = isDeferred ? resolveDeferredCommitValue() : null;
    selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: value };
    onStepChange?.(activeStep.id, value);
    writeOtherDraft('');
    setOtherChecked(false);
    setPendingValue(null);

    if (stepIndex < stepTotalSteps - 1) {
      setDirection('forward');
      setStepIndex((i) => i + 1);
    } else {
      onComplete?.(selectionsRef.current);
    }
  }, [
    activeStep,
    disabled,
    isDeferred,
    isMultiSelect,
    isMultiStep,
    onComplete,
    onStepChange,
    resolveDeferredCommitValue,
    setPendingValue,
    stepIndex,
    stepTotalSteps,
  ]);

  const handleSingleStepDeferredSkip = useCallback(() => {
    if (disabled) return;
    onSkip?.();
  }, [disabled, onSkip]);

  const handleOtherFreeformSubmit = useCallback(
    (
      value: string,
      event: ReactKeyboardEvent<HTMLInputElement> | ReactMouseEvent<HTMLButtonElement>,
    ) => {
      if (disabled) return;
      handleConfirm(value, { event });
    },
    [disabled, handleConfirm],
  );

  const handleCheckboxToggle = useCallback(
    (value: string) => {
      if (disabled) return;
      writeMultiChecked((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      );
    },
    [disabled, writeMultiChecked],
  );

  const handleMultiConfirm = useCallback(() => {
    if (disabled || !isMultiStep || !activeStep) return;
    const value = buildMultiSelectValue(allowOther, multiChecked, otherChecked, otherDraft);
    selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: value };
    onStepChange?.(activeStep.id, value);
    writeOtherDraft('');
    setOtherChecked(false);

    if (stepIndex < stepTotalSteps - 1) {
      setDirection('forward');
      setStepIndex((i) => i + 1);
    } else {
      onComplete?.(selectionsRef.current);
    }
  }, [
    disabled,
    isMultiStep,
    activeStep,
    allowOther,
    multiChecked,
    otherChecked,
    otherDraft,
    stepIndex,
    stepTotalSteps,
    onStepChange,
    onComplete,
  ]);

  const handleSkip = useCallback(() => {
    if (disabled || !isMultiStep || !activeStep) return;
    selectionsRef.current = { ...selectionsRef.current, [activeStep.id]: null };
    onStepChange?.(activeStep.id, null);
    writeOtherDraft('');
    setOtherChecked(false);
    if (stepIndex < stepTotalSteps - 1) {
      setDirection('forward');
      setStepIndex((i) => i + 1);
    } else {
      onComplete?.(selectionsRef.current);
    }
  }, [disabled, isMultiStep, activeStep, stepIndex, stepTotalSteps, onStepChange, onComplete]);

  // -- Aria label resolution --
  const resolvedAriaLabel =
    ariaLabel ??
    ariaLabelAttribute ??
    (isMultiStep && activeStep
      ? (activeStep.ariaLabel ??
        (typeof activeStep.title === 'string' ? activeStep.title : undefined))
      : undefined) ??
    (typeof title === 'string' ? title : undefined) ??
    DEFAULT_ARIA_LABEL;

  const hasHeader = effectiveTitle != null;

  // -- Focus management: move focus into the step content after transitions --
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  useChoiceListNumberShortcuts({
    surfaceRef,
    config: numberKeyShortcuts,
    disabled,
    selectionMode: isMultiSelect ? 'multiple' : 'single',
    commitBehavior,
  });
  const prevStepIndexRef = useRef(stepIndex);
  // Stable ref so the active-step effect below never re-fires due to a
  // new inline function reference from the consumer.
  const onActiveStepChangeRef = useRef(onActiveStepChange);
  onActiveStepChangeRef.current = onActiveStepChange;
  useEffect(() => {
    if (!isMultiStep) return;
    if (prevStepIndexRef.current === stepIndex) return;
    prevStepIndexRef.current = stepIndex;
    const surface = surfaceRef.current;
    if (!surface) return;
    const target =
      surface.querySelector<HTMLElement>(
        '.airo-input-choice-list__step fieldset input[type="checkbox"][tabindex="0"]',
      ) ??
      surface.querySelector<HTMLElement>(
        '.airo-input-choice-list__step fieldset input[type="checkbox"]',
      ) ??
      surface.querySelector<HTMLElement>('.airo-input-choice-list__step [role="listbox"]');
    target?.focus();
  }, [isMultiStep, stepIndex]);

  // -- Active-step notification: fires on initial mount, forward, and back.
  // Separate from onStepChange (which fires only on forward commit) so
  // surrounding chrome that mirrors the active step can stay in sync even
  // when the user presses Back. Uses the primitive `activeStepId` (declared
  // above) so this does not fire on every parent re-render that produces new
  // element refs for the same step.
  useEffect(() => {
    if (!isMultiStep || !activeStepId) return;
    onActiveStepChangeRef.current?.(activeStepId, stepIndex);
  }, [isMultiStep, activeStepId, stepIndex]);

  // Mark the first multi-step render complete so the slide plays only on
  // subsequent step transitions, never on initial appearance. See the
  // `hasRenderedStepRef` declaration above.
  useEffect(() => {
    if (isMultiStep) hasRenderedStepRef.current = true;
  }, [isMultiStep]);

  // -- Multi-step wrapper with slide transition --
  const stepKey = isMultiStep && activeStep ? activeStep.id : undefined;
  const collectedIds = useMemo(() => new Set(collected.map((c) => c.id)), [collected]);
  const stepSelectedRaw = activeStep ? selectionsRef.current[activeStep.id] : undefined;
  const stepSelectedFromSaved =
    typeof stepSelectedRaw === 'string' && collectedIds.has(stepSelectedRaw)
      ? stepSelectedRaw
      : undefined;
  const stepSelected =
    isDeferred && !isMultiSelect ? (pendingValue ?? stepSelectedFromSaved) : stepSelectedFromSaved;
  const singleStepSelected = isDeferred ? (pendingValue ?? undefined) : undefined;
  const deferredContinueDisabled = !resolveDeferredCommitValue();
  const showSingleStepDeferredFooter = isDeferred && !isMultiStep && showDeferredFooter;
  const showMultiStepDeferredContinue = isDeferred && !isMultiSelect;

  const handleOtherDraftChange = useCallback(
    (next: string) => {
      writeOtherDraft(next);
      if (isDeferred && next.trim()) {
        setPendingValue(null);
      }
    },
    [isDeferred, setPendingValue, writeOtherDraft],
  );

  const handleOtherFocus = useCallback(() => {
    if (isDeferred && !isMultiSelect) {
      setPendingValue(null);
    }
    onOtherFocus?.();
  }, [isDeferred, isMultiSelect, onOtherFocus, setPendingValue]);

  const surfaceClassName = 'airo-input-choice-list__surface';

  const surfaceBody = (
    <>
      {hasHeader ? (
        <ChoiceListHeader
          title={effectiveTitle}
          onClose={onClose}
          closeLabel={closeLabel}
          disabled={disabled}
        />
      ) : null}
      {isMultiStep ? (
        <>
          <MultiStepSlot
            key={stepKey}
            direction={direction}
            animateOnMount={hasRenderedStepRef.current}
          >
            {isMultiSelect ? (
              <MultiSelectOptionPanel
                collected={collected}
                checked={effectiveMultiChecked}
                onToggle={handleCheckboxToggle}
                loop={loop}
                ariaLabel={resolvedAriaLabel}
                ariaLabelledBy={ariaLabelledByAttribute}
                optionDividers={optionDividers}
                disabled={disabled}
                allowOther={allowOther}
                otherPlaceholder={activeOtherPlaceholder}
                otherAriaLabel={activeOtherAriaLabel}
                otherCheckboxAriaLabel={effectiveOtherCheckboxAriaLabel}
                otherChecked={effectiveOtherChecked}
                otherDraft={otherDraft}
                onOtherCheckedChange={writeOtherChecked}
                onOtherDraftChange={writeOtherDraft}
                onOtherEnterConfirm={handleMultiConfirm}
              />
            ) : (
              <ListboxSingleSelectPanel
                collected={collected}
                onConfirm={handleListboxActivate}
                loop={loop}
                ariaLabel={resolvedAriaLabel}
                ariaLabelledBy={ariaLabelledByAttribute}
                selected={stepSelected}
                optionDividers={optionDividers}
                showOptionChevron={showOptionChevron}
                showOptionArrowOnHover={showOptionArrowOnHover}
                suppressLastRowBottomBorder={suppressLastRowBottomBorder}
                inlineSkipLabel={inlineSkipLabel}
                onInlineSkip={onInlineSkip}
                inlineSkipOrSubmit={inlineSkipOrSubmit}
                otherSubmitTestId={otherSubmitTestId}
                inlineSkipTestId={inlineSkipTestId}
                inlineBackLabel={inlineBackLabel}
                onInlineBack={onInlineBack}
                inlineBackTestId={inlineBackTestId}
                disabled={disabled}
                allowOther={allowOther}
                otherPlaceholder={activeOtherPlaceholder}
                otherAriaLabel={activeOtherAriaLabel}
                onOtherSubmit={allowOther ? handleOtherFreeformSubmit : undefined}
                otherSubmitLabel={otherSubmitLabel}
                showOtherSubmitButton={showOtherSubmitButton}
                otherDraft={allowOther ? otherDraft : undefined}
                onOtherDraftChange={allowOther ? handleOtherDraftChange : undefined}
                onOtherFocus={allowOther ? handleOtherFocus : undefined}
              />
            )}
          </MultiStepSlot>
          <ChoiceListFooter
            currentStep={effectiveCurrentStep}
            totalSteps={effectiveTotalSteps}
            stepIndicatorLabel={stepIndicatorLabel}
            onBack={effectiveOnBack}
            onForward={effectiveOnForward}
            backLabel={backLabel}
            forwardLabel={forwardLabel}
            skipLabel={skipLabel}
            onSkip={handleSkip}
            continueLabel={isMultiSelect || showMultiStepDeferredContinue ? continueLabel : undefined}
            onContinue={
              isMultiSelect
                ? handleMultiConfirm
                : showMultiStepDeferredContinue
                  ? handleDeferredMultiStepContinue
                  : undefined
            }
            continueDisabled={showMultiStepDeferredContinue ? deferredContinueDisabled : false}
            disabled={disabled}
          />
        </>
      ) : (
        <>
          {isMultiSelect ? (
            <MultiSelectOptionPanel
              collected={collected}
              checked={effectiveMultiChecked}
              onToggle={handleCheckboxToggle}
              loop={loop}
              ariaLabel={resolvedAriaLabel}
              ariaLabelledBy={ariaLabelledByAttribute}
              optionDividers={optionDividers}
              disabled={disabled}
              allowOther={allowOther}
              otherPlaceholder={effectiveOtherPlaceholder}
              otherAriaLabel={otherAriaLabel}
              otherCheckboxAriaLabel={effectiveOtherCheckboxAriaLabel}
              otherChecked={effectiveOtherChecked}
              otherDraft={otherDraft}
              onOtherCheckedChange={writeOtherChecked}
              onOtherDraftChange={writeOtherDraft}
            />
          ) : (
            <ListboxSingleSelectPanel
              collected={collected}
              onConfirm={handleListboxActivate}
              loop={loop}
              ariaLabel={resolvedAriaLabel}
              ariaLabelledBy={ariaLabelledByAttribute}
              selected={singleStepSelected}
              optionDividers={optionDividers}
              showOptionChevron={showOptionChevron}
              showOptionArrowOnHover={showOptionArrowOnHover}
              suppressLastRowBottomBorder={suppressLastRowBottomBorder}
              inlineSkipLabel={inlineSkipLabel}
              onInlineSkip={onInlineSkip}
              inlineSkipOrSubmit={inlineSkipOrSubmit}
              otherSubmitTestId={otherSubmitTestId}
              inlineSkipTestId={inlineSkipTestId}
              inlineBackLabel={inlineBackLabel}
              onInlineBack={onInlineBack}
              inlineBackTestId={inlineBackTestId}
              disabled={disabled}
              allowOther={allowOther}
              otherPlaceholder={effectiveOtherPlaceholder}
              otherAriaLabel={otherAriaLabel}
              onOtherSubmit={allowOther ? handleOtherFreeformSubmit : undefined}
              otherSubmitLabel={otherSubmitLabel}
              showOtherSubmitButton={showOtherSubmitButton}
              otherDraft={allowOther ? otherDraft : undefined}
              onOtherDraftChange={allowOther ? handleOtherDraftChange : undefined}
              onOtherFocus={allowOther ? handleOtherFocus : undefined}
            />
          )}
          {showSingleStepDeferredFooter ? (
            <ChoiceListFooter
              skipLabel={skipLabel}
              onSkip={handleSingleStepDeferredSkip}
              continueLabel={continueLabel}
              onContinue={handleDeferredContinue}
              continueDisabled={deferredContinueDisabled}
              disabled={disabled}
              backLabel={backLabel}
              forwardLabel={forwardLabel}
            />
          ) : null}
        </>
      )}
    </>
  );

  const rootClassName = classnames(
    'airo-input-choice-list',
    disabled && 'airo-input-choice-list--disabled',
    isMultiStep && 'airo-input-choice-list--multi-step',
    surfaceClassName,
    className,
  );

  return (
    <div
      {...safeRest}
      ref={surfaceRef}
      aria-disabled={disabled ? true : undefined}
      inert={disabled ? true : undefined}
      style={disabled ? { ...safeRest.style, pointerEvents: 'none' } : safeRest.style}
      className={rootClassName}
    >
      {surfaceBody}
    </div>
  );
}

/**
 * Public API: `ChoiceList` plus its compound `Item` and `Step` slots.
 */
export const ChoiceList = Object.assign(ChoiceListRoot, {
  Item: ChoiceListItem,
  Step: ChoiceListStep,
});

export type { ChoiceListItemProps } from './ChoiceListItem';
export type { ChoiceListStepProps } from './ChoiceListStep';

export type ChoiceListItemElement = ReactElement<ChoiceListItemProps, typeof ChoiceListItem>;
