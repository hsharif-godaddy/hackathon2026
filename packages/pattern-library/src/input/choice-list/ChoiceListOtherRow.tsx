import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
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
  onSubmit,
  submitLabel = 'Submit',
  onArrowUpExit,
  fieldRef,
  draft: draftProp,
  onDraftChange,
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

  return (
    <div
      className={classnames(
        'airo-input-choice-list__other-row',
        optionDividers && 'airo-input-choice-list__other-row--option-dividers',
      )}
    >
      <div className="airo-input-choice-list__other-row-inner">
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
            disabled={disabled}
            placeholder={otherPlaceholder}
            className="airo-input-choice-list__other-entry"
            aria-label={otherAriaLabel ?? otherPlaceholder}
          />
        </span>
        <span className="airo-input-choice-list__other-submit">
          <Button
            design="primary"
            size="small"
            type="button"
            aria-label={submitLabel}
            disabled={!canSubmit}
            icon={<AsyncIcon icon="arrow-right" />}
            onClick={handleSubmitClick}
          />
        </span>
      </div>
    </div>
  );
}
