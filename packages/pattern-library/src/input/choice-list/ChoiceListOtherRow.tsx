import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import Tag from '@ux/tag';
import TextEntry from '@ux/text-entry';
import classnames from 'classnames';
import {
  type KeyboardEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  useId,
  useState,
} from 'react';

export interface ChoiceListInlineRowActionsProps {
  disabled?: boolean;
  inlineBackLabel?: string;
  onInlineBack?: () => void;
  inlineBackTestId?: string;
  inlineSkipLabel?: string;
  onInlineSkip?: () => void;
  inlineSkipTestId?: string;
}

export function ChoiceListInlineRowActions({
  disabled = false,
  inlineBackLabel,
  onInlineBack,
  inlineBackTestId,
  inlineSkipLabel,
  onInlineSkip,
  inlineSkipTestId,
}: ChoiceListInlineRowActionsProps) {
  const showBack = Boolean(inlineBackLabel && onInlineBack);
  const showSkip = Boolean(inlineSkipLabel && onInlineSkip);
  if (!showBack && !showSkip) return null;

  return (
    <span className="airo-input-choice-list__inline-row-actions">
      {showBack ? (
        <Button
          design="control"
          size="small"
          type="button"
          aria-label={inlineBackLabel}
          disabled={disabled}
          data-testid={inlineBackTestId}
          icon={<AsyncIcon icon="arrow-left" />}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onInlineBack?.();
          }}
        />
      ) : null}
      {showSkip ? (
        <Button
          design="control"
          size="small"
          type="button"
          text={inlineSkipLabel}
          disabled={disabled}
          data-testid={inlineSkipTestId}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onInlineSkip?.();
          }}
        />
      ) : null}
    </span>
  );
}

/**
 * Props for the freeform "Other" entry row rendered within `ChoiceList`.
 */
export interface ChoiceListOtherRowProps {
  /**
   * Placeholder (and default accessible name) for the freeform field.
   * The parent supplies the resolved string, including any default.
   */
  otherPlaceholder: string;
  /**
   * Optional `aria-label` on the text field when you need SR wording
   * different from the placeholder.
   */
  otherAriaLabel?: string;
  /** When `true`, the field does not accept input and `onSubmit` does not run. */
  disabled: boolean;
  /** Match listbox row seams when `optionDividers` is enabled on `ChoiceList`. */
  optionDividers: boolean;
  /**
   * When `true`, omits the bottom border on this row (stack terminus).
   * @default false
   */
  suppressBottomBorder?: boolean;
  /**
   * Option indicator (1, 2, 3, …) shown as a passive-emphasis badge to the
   * inline-start of the field, matching regular listbox options.
   */
  letter?: string;
  /**
   * Fires when the user commits non-empty trimmed text — either by
   * pressing Enter in the field or by clicking the inline submit
   * button. The parent typically routes this to the same path as a
   * listbox decision.
   */
  onSubmit: (
    trimmedValue: string,
    event: ReactKeyboardEvent<HTMLInputElement> | ReactMouseEvent<HTMLButtonElement>,
  ) => void;
  /**
   * Accessible label for the inline submit button. Defaults to
   * `"Submit"`. Matches the `continueLabel` pattern used by the
   * multi-select Continue button.
   */
  submitLabel?: string;
  /**
   * When `false`, hides the inline submit button beside the single-select
   * Other field. Enter still commits when {@link onSubmit} is wired.
   * @default true
   */
  showSubmitButton?: boolean;
  /**
   * Visible label for an inline Skip control shown beside the field.
   */
  inlineSkipLabel?: string;
  /** Fires when the inline Skip control is activated. */
  onInlineSkip?: () => void;
  /**
   * When `true`, shows Skip while the draft is empty and a primary Submit
   * button once the user has typed text.
   * @default false
   */
  inlineSkipOrSubmit?: boolean;
  /** Accessible label for an inline Back control beside Skip or Submit. */
  inlineBackLabel?: string;
  /** Fires when the inline Back control is activated. */
  onInlineBack?: () => void;
  /** Optional `data-testid` for the inline Submit button. */
  submitTestId?: string;
  /** Optional `data-testid` for the inline Skip button. */
  inlineSkipTestId?: string;
  /** Optional `data-testid` for the inline Back button. */
  inlineBackTestId?: string;
  /**
   * When focus is in the field and the user presses Arrow Up with the caret at
   * the start (single-line), the parent typically returns focus to the listbox.
   */
  onArrowUpExit?: () => void;
  /** Ref to the underlying input (for programmatic focus from the listbox). */
  fieldRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  /**
   * Current draft value for the freeform field. When `onDraftChange` is provided,
   * the row is controlled; if `draft` is also provided, it supplies the current
   * value (for example, when restoring a persisted freeform answer). If `draft`
   * is provided without `onDraftChange`, the row continues to keep its own
   * internal draft.
   */
  draft?: string;
  onDraftChange?: (next: string) => void;
  /** Fires when the freeform field receives focus. */
  onOtherFocus?: () => void;
}

/**
 * Single-select “other” row: underline-style `TextEntry` only (copy lives in
 * `placeholder`). Lives outside `@ux/listbox` so the field is not a listbox option.
 */
export function ChoiceListOtherRow({
  otherPlaceholder,
  otherAriaLabel,
  disabled,
  optionDividers,
  suppressBottomBorder = false,
  letter,
  onSubmit,
  submitLabel = 'Submit',
  showSubmitButton = true,
  inlineSkipLabel,
  onInlineSkip,
  inlineSkipOrSubmit = false,
  inlineBackLabel,
  onInlineBack,
  submitTestId,
  inlineSkipTestId,
  inlineBackTestId,
  onArrowUpExit,
  fieldRef,
  draft: draftProp,
  onDraftChange,
  onOtherFocus,
}: ChoiceListOtherRowProps) {
  const [uncontrolledDraft, setUncontrolledDraft] = useState('');
  const controlled = onDraftChange != null;
  const draft = controlled ? (draftProp ?? '') : uncontrolledDraft;
  const entryId = useId();

  const trimmed = draft.trim();
  const canSubmit = !disabled && trimmed.length > 0;

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement> = (e) => {
    if (disabled) return;
    if (e.key === 'Enter') {
      if (!trimmed) return;
      e.preventDefault();
      onSubmit(trimmed, e as ReactKeyboardEvent<HTMLInputElement>);
      return;
    }
    if (e.key === 'ArrowUp' && onArrowUpExit) {
      const el = e.currentTarget;
      if (el instanceof HTMLInputElement && el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault();
        onArrowUpExit();
      }
    }
  };

  const handleSubmitClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!canSubmit) return;
    onSubmit(trimmed, e);
  };

  const showInlineSkipOrSubmit = inlineSkipOrSubmit && inlineSkipLabel && onInlineSkip;
  const showLegacySubmit = !showInlineSkipOrSubmit && showSubmitButton;
  const showInlineSkipOnly =
    !showInlineSkipOrSubmit && !showSubmitButton && inlineSkipLabel && onInlineSkip;
  const showInlineBack = Boolean(inlineBackLabel && onInlineBack);
  const showCompactBottom =
    showInlineSkipOrSubmit || showInlineSkipOnly || showInlineBack || showLegacySubmit;

  return (
    <div
      className={classnames(
        'airo-input-choice-list__other-row',
        optionDividers && 'airo-input-choice-list__other-row--option-dividers',
        suppressBottomBorder && 'airo-input-choice-list__other-row--suppress-bottom-border',
      )}
    >
      <div
        className={classnames(
          'airo-input-choice-list__other-row-inner',
          showCompactBottom && 'airo-input-choice-list__other-row-inner--compact-bottom',
          !showCompactBottom && 'airo-input-choice-list__other-row-inner--no-submit',
        )}
      >
        {letter !== undefined ? (
          <Tag
            className="airo-input-choice-list__item-content-letter"
            size="sm"
            emphasis="passive"
            aria-hidden="true"
          >
            {letter}
          </Tag>
        ) : null}
        <span className="airo-input-choice-list__other-entry-wrap">
          <TextEntry
            // @ux/text-entry types `ref` as an impossible intersection of input + textarea refs.
            ref={fieldRef as never}
            id={entryId}
            multiline={false}
            stretch
            visualSize="sm"
            value={draft}
            onChange={(v: string | number) => {
              const next = String(v);
              if (controlled) onDraftChange(next);
              else setUncontrolledDraft(next);
            }}
            onKeyDown={handleKeyDown}
            onFocus={onOtherFocus}
            disabled={disabled}
            placeholder={otherPlaceholder}
            className="airo-input-choice-list__other-entry"
            aria-label={otherAriaLabel ?? otherPlaceholder}
          />
        </span>
        {showInlineSkipOrSubmit ? (
          canSubmit ? (
            <span className="airo-input-choice-list__inline-row-actions">
              {showInlineBack ? (
                <Button
                  design="control"
                  size="small"
                  type="button"
                  aria-label={inlineBackLabel}
                  disabled={disabled}
                  data-testid={inlineBackTestId}
                  icon={<AsyncIcon icon="arrow-left" />}
                  onClick={() => onInlineBack?.()}
                />
              ) : null}
              <span className="airo-input-choice-list__other-submit">
                <Button
                  design="primary"
                  size="small"
                  type="button"
                  aria-label={submitLabel}
                  disabled={!canSubmit}
                  data-testid={submitTestId}
                  icon={<AsyncIcon icon="arrow-right" />}
                  onClick={handleSubmitClick}
                />
              </span>
            </span>
          ) : (
            <ChoiceListInlineRowActions
              disabled={disabled}
              inlineBackLabel={inlineBackLabel}
              onInlineBack={onInlineBack}
              inlineBackTestId={inlineBackTestId}
              inlineSkipLabel={inlineSkipLabel}
              onInlineSkip={onInlineSkip}
              inlineSkipTestId={inlineSkipTestId}
            />
          )
        ) : null}
        {showLegacySubmit ? (
          <span className="airo-input-choice-list__other-submit">
            <Button
              design="primary"
              size="small"
              type="button"
              aria-label={submitLabel}
              disabled={!canSubmit}
              data-testid={submitTestId}
              icon={<AsyncIcon icon="arrow-right" />}
              onClick={handleSubmitClick}
            />
          </span>
        ) : null}
        {showInlineSkipOnly ? (
          <ChoiceListInlineRowActions
            disabled={disabled}
            inlineBackLabel={inlineBackLabel}
            onInlineBack={onInlineBack}
            inlineBackTestId={inlineBackTestId}
            inlineSkipLabel={inlineSkipLabel}
            onInlineSkip={onInlineSkip}
            inlineSkipTestId={inlineSkipTestId}
          />
        ) : null}
      </div>
    </div>
  );
}
