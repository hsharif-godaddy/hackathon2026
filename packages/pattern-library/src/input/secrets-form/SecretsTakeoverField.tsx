import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';
import classnames from 'classnames';
import {
  type KeyboardEventHandler,
  type ReactNode,
  type Ref,
  forwardRef,
} from 'react';

export interface SecretsTakeoverFieldProps {
  entryId: string;
  label: ReactNode;
  labelId?: string;
  value: string;
  placeholder?: string;
  helperText?: ReactNode;
  helperTextId?: string;
  errorId?: string;
  blockingReason?: string;
  showValidationError?: boolean;
  visible: boolean;
  hasValue: boolean;
  hideSecretLabel?: string;
  showSecretLabel?: string;
  maxLength?: number;
  onChange: (next: string | number) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onToggleVisibility: () => void;
}

export const SecretsTakeoverField = forwardRef(function SecretsTakeoverField(
  {
    entryId,
    label,
    labelId,
    value,
    placeholder = 'Enter value',
    helperText,
    helperTextId,
    errorId,
    blockingReason,
    showValidationError = false,
    visible,
    hasValue,
    hideSecretLabel = 'Hide value',
    showSecretLabel = 'Show value',
    maxLength,
    onChange,
    onKeyDown,
    onToggleVisibility,
  }: SecretsTakeoverFieldProps,
  ref: Ref<HTMLInputElement>,
) {
  const describedBy =
    [helperText && helperTextId, showValidationError && errorId].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="airo-input-secrets-form__takeover-field">
      <text.label
        as="paragraph"
        size={-1}
        id={labelId}
        htmlFor={entryId}
        className="airo-input-secrets-form__label"
      >
        {label}
      </text.label>

      <div className="airo-input-secrets-form__takeover-entry-row">
        <span className="airo-input-secrets-form__takeover-entry-wrap">
          <TextEntry
            ref={ref as never}
            id={entryId}
            stretch
            visualSize="sm"
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-describedby={describedBy}
            aria-invalid={showValidationError}
            invalid={showValidationError}
            type={visible && hasValue ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            maxLength={maxLength}
            className="airo-input-secrets-form__takeover-entry"
          />
        </span>
        <span className="airo-input-secrets-form__takeover-entry-action">
          <Button
            design="inline"
            size="small"
            type="button"
            icon={<AsyncIcon icon={visible && hasValue ? 'hide' : 'show'} />}
            aria-label={visible && hasValue ? hideSecretLabel : showSecretLabel}
            disabled={!hasValue}
            onClick={onToggleVisibility}
            className={classnames(
              'airo-input-secrets-form__visibility-toggle',
              'airo-input-secrets-form__chrome-button',
            )}
          />
        </span>
      </div>

      {(helperText || (showValidationError && blockingReason)) && (
        <div className="airo-input-secrets-form__takeover-messages">
          {helperText ? (
            <text.span
              as="caption"
              size={-2}
              emphasis="passive"
              id={helperTextId}
              className="airo-input-secrets-form__helper-text"
            >
              {helperText}
            </text.span>
          ) : null}
          {showValidationError && blockingReason ? (
            <output id={errorId} aria-live="polite" className="airo-input-secrets-form__error-text">
              <text.span as="caption" size={-2} emphasis="critical">
                {blockingReason}
              </text.span>
            </output>
          ) : null}
        </div>
      )}
    </div>
  );
});
