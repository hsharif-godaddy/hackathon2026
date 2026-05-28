import Box from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';
import classnames from 'classnames';
import {
  type HTMLAttributes,
  type KeyboardEventHandler,
  type Ref,
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

/** Where the form is mounted: composer strip vs in-thread message. */
export type SecretsFormVariant = 'composer' | 'conversation';

/**
 * Optional overrides for built-in validation copy (localization).
 * Omit keys to keep English defaults.
 */
export type SecretsFormValidationMessages = {
  /** Shown when the trimmed value is empty and **`minLength`** ≥ 1 blocks submit. */
  empty?: string;
  /** Shown when the trimmed value is shorter than **`minLength`** (when **`minLength`** > 1). */
  minLength?: (min: number) => string;
  /** Shown when the raw value exceeds **`maxLength`**. */
  maxLength?: (max: number) => string;
};

/**
 * Fields shared by {@link SecretsFormComposerProps} and {@link SecretsFormConversationProps}.
 *
 * Stateful field: **`value`** + **`onChange`** (controlled) or **`defaultValue`** (uncontrolled).
 *
 * @see ./README.md
 */
export interface SecretsFormSharedProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange' | 'onSubmit'> {
  /**
   * Title line above the secret name (e.g. **"New Secret"**). Rendered as an **`h3`**
   * with caption-scale typography so the card has a proper document heading — use **title
   * case** and **no terminal period** (short heading, not body eyebrow copy).
   * @default "New Secret"
   */
  eyebrow?: string;
  /**
   * Secret name shown in the header (e.g. "DISCOGS_TOKEN:"). Rendered as a **`<label htmlFor={…}>`**
   * for the password field (same visual treatment as before).
   */
  label: string;
  /**
   * Supplementary copy for the field (e.g. where to get the token).
   * **`variant="composer"`:** shown in the **bottom toolbar** (same row as send).
   * **`variant="conversation"`:** shown **below the input** in the stacked messages area
   * (with validation), not in a toolbar row.
   */
  helperText?: string;
  /**
   * Controlled value of the password field. When provided the component
   * is fully controlled — the caller must update it on every `onChange`.
   * Omit to use uncontrolled mode with an optional `defaultValue`.
   *
   * @see defaultValue
   * @see onChange
   */
  value?: string;
  /**
   * Initial value in uncontrolled mode. @default ""
   *
   * @see value
   * @see onChange
   */
  defaultValue?: string;
  /**
   * Called on every keystroke with the new field value.
   *
   * @see value
   * @see defaultValue
   */
  onChange?: (value: string) => void;
  /** Placeholder for the password input. @default "Enter value" */
  placeholder?: string;
  /**
   * When **`true`**, the primary submit control is **disabled** and **`onSubmit`** does not
   * run — use while persistence is in-flight to avoid duplicate submission. Between the
   * user gesture and your state update, this component also tracks an internal in-flight
   * guard while **`onSubmit`** is awaited so rapid clicks / Enter cannot invoke it twice.
   * There is **no**
   * built-in loading spinner or label change; reflect saving state in the host when needed.
   * @default false
   */
  pending?: boolean;
  /**
   * Called with the trimmed value when the user clicks send/save or presses Enter.
   * When **omitted**, a valid submit **does not dismiss** the form (no-op persistence path);
   * production surfaces should always pass **`onSubmit`**.
   * After this **returns** (including resolving a **`Promise`**) **without throwing**, the form
   * **dismisses** (renders `null`) so the host surface can move on—same lifecycle idea as
   * **`ChoiceList`** after **`onDecision`**. The host owns follow-up UI (e.g. **`Thinker`**,
   * **`AgentMessage`**) and persistence; this component does not render those. Remount with a
   * new **`key`** when another secret is needed.
   */
  onSubmit?: (value: string) => void | Promise<void>;
  /**
   * Minimum **trimmed** length required before submit. Empty / whitespace-only
   * values never submit when this is at least `1` (default).
   * @default 1
   */
  minLength?: number;
  /**
   * Maximum **raw** character count in the field (matches the native **`maxLength`**
   * attribute). Validation uses the same raw length so limits stay consistent with the
   * browser cap.
   */
  maxLength?: number;
  /**
   * Optional synchronous validation on the **trimmed** value. Return a short
   * message to block submit and show it inline; return `undefined` when valid.
   * Use this for format checks (including regex) in app code so patterns and
   * policies stay in your bundle, not in generic examples.
   */
  validate?: (trimmedValue: string) => string | undefined;
  /**
   * **`composer`:** accessible name for the icon-only send control. Defaults to **"Send"** when omitted.
   * **`conversation`:** visible label for the primary save button. Defaults to **"Save"** when omitted.
   */
  submitLabel?: string;
  /** Accessible label for the header close button (`variant="composer"` only). @default "Close" */
  closeLabel?: string;
  /** Visible label for the cancel button (`variant="conversation"` only). @default "Cancel" */
  cancelLabel?: string;
  /** Accessible label for the show-secret control when the field has a value. @default "Show value" */
  showSecretLabel?: string;
  /** Accessible label for the hide-secret control when the field has a value. @default "Hide value" */
  hideSecretLabel?: string;
  /**
   * Overrides for built-in validation strings (e.g. i18n). Defaults are English.
   */
  validationMessages?: Partial<SecretsFormValidationMessages>;
  /**
   * When `true`, strips the form's outer card chrome (background, border,
   * radius, elevation, and overflow clip). The internal layout — header
   * lockup, input row, toolbar / footer buttons — stays intact.
   *
   * Use this when nesting the form inside a host that already provides a
   * surface, e.g. a `PromptBox` expansion area or a `PromptStage` swap
   * slot. Composes with both `variant="composer"` and
   * `variant="conversation"`.
   *
   * @default false
   */
  borderless?: boolean;
}

/**
 * {@link SecretsForm} in **`variant="composer"`** (default) — replaces the chat input.
 * Header **close (X)** is always shown; **`onClose`** is **required** so the user can reject
 * the agent’s request without submitting a value.
 */
export interface SecretsFormComposerProps extends SecretsFormSharedProps {
  variant?: 'composer';
  /** Reject / dismiss without persisting — wired to the header **close (X)**. */
  onClose: () => void;
}

/**
 * {@link SecretsForm} in **`variant="conversation"`** — in-thread card. **Cancel** is shown
 * only when **`onClose`** is provided.
 */
export interface SecretsFormConversationProps extends SecretsFormSharedProps {
  variant: 'conversation';
  /** Wired to **Cancel** when provided; omit to hide **Cancel**. */
  onClose?: () => void;
}

/** Public props — **`onClose`** is required in **`composer`**, optional in **`conversation`**. */
export type SecretsFormProps = SecretsFormComposerProps | SecretsFormConversationProps;

function SecretsFormRoot(
  {
    variant = 'composer',
    eyebrow = 'New Secret',
    label,
    helperText,
    value,
    defaultValue = '',
    onChange,
    placeholder = 'Enter value',
    pending = false,
    minLength = 1,
    maxLength,
    validate,
    onSubmit,
    onClose,
    submitLabel,
    closeLabel = 'Close',
    cancelLabel = 'Cancel',
    showSecretLabel = 'Show value',
    hideSecretLabel = 'Hide value',
    validationMessages,
    borderless = false,
    className,
    ...rest
  }: SecretsFormProps,
  ref: Ref<HTMLInputElement>,
) {
  const isComposer = variant === 'composer';
  const effectiveSubmitLabel = submitLabel ?? (isComposer ? 'Send' : 'Save');
  const entryId = useId();
  const labelId = useId();
  const helperTextId = useId();
  const errorId = useId();
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [visible, setVisible] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [dismissedAfterSubmit, setDismissedAfterSubmit] = useState(false);
  /** Blocks duplicate submit while `onSubmit` is awaited (before host can set `pending`). */
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const submitInFlightRef = useRef(false);
  /** Cleared on unmount so async `onSubmit` completion does not call `setState` after teardown. */
  const mountedRef = useRef(true);

  const currentValue = isControlled ? (value ?? '') : internalValue;
  const hasValue = currentValue.length > 0;
  const trimmedValue = currentValue.trim();

  const resolvedValidationMessages = useMemo(
    function resolveValidationMessages() {
      return {
        empty: validationMessages?.empty ?? 'Enter a value.',
        minLength:
          validationMessages?.minLength ??
          function minLenMessage(min: number) {
            return `Enter at least ${min} characters.`;
          },
        maxLength:
          validationMessages?.maxLength ??
          function maxLenMessage(max: number) {
            return `Use at most ${max} characters.`;
          },
      };
    },
    [validationMessages],
  );

  const blockingReason = useMemo(
    function computeBlockingReason() {
      if (maxLength !== undefined && currentValue.length > maxLength) {
        return resolvedValidationMessages.maxLength(maxLength);
      }
      if (trimmedValue.length < minLength) {
        if (minLength <= 1) {
          return resolvedValidationMessages.empty;
        }
        return resolvedValidationMessages.minLength(minLength);
      }
      return validate?.(trimmedValue);
    },
    [currentValue, trimmedValue, minLength, maxLength, validate, resolvedValidationMessages],
  );

  const cannotSubmit = Boolean(pending || blockingReason || submitInFlight);

  const showValidationError = Boolean(
    blockingReason &&
      (submitAttempted || trimmedValue.length > 0 || (hasValue && trimmedValue.length === 0)),
  );

  useEffect(
    function clearSubmitAttemptWhenValid() {
      if (!blockingReason) setSubmitAttempted(false);
    },
    [blockingReason],
  );

  useEffect(
    function resetVisibilityWhenEmpty() {
      if (!hasValue) setVisible(false);
    },
    [hasValue],
  );

  useEffect(function trackMounted() {
    mountedRef.current = true;
    return function cleanup() {
      mountedRef.current = false;
    };
  }, []);

  const handleChange = useCallback(
    function change(next: string | number) {
      const s = String(next);
      if (!isControlled) setInternalValue(s);
      onChange?.(s);
    },
    [isControlled, onChange],
  );

  const handleSubmit = useCallback(
    async function submit() {
      if (dismissedAfterSubmit) return;
      if (pending) return;
      if (submitInFlightRef.current) return;
      if (blockingReason) {
        setSubmitAttempted(true);
        return;
      }
      submitInFlightRef.current = true;
      setSubmitInFlight(true);
      if (!onSubmit) {
        submitInFlightRef.current = false;
        setSubmitInFlight(false);
        return;
      }
      try {
        await Promise.resolve(onSubmit(trimmedValue));
      } catch {
        submitInFlightRef.current = false;
        if (mountedRef.current) {
          setSubmitInFlight(false);
        }
        return;
      }
      if (!mountedRef.current) {
        submitInFlightRef.current = false;
        return;
      }
      if (!isControlled) setInternalValue('');
      setVisible(false);
      setDismissedAfterSubmit(true);
      submitInFlightRef.current = false;
      setSubmitInFlight(false);
    },
    [dismissedAfterSubmit, pending, blockingReason, trimmedValue, onSubmit, isControlled],
  );

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
    function keyDown(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (pending || submitInFlightRef.current) return;
        void handleSubmit();
      }
    },
    [handleSubmit, pending],
  );

  const toggleVisibility = useCallback(function toggle() {
    setVisible((v) => !v);
  }, []);

  const describedBy =
    [helperText && helperTextId, showValidationError && errorId].filter(Boolean).join(' ') ||
    undefined;

  const messagesSlot = (helperText || (showValidationError && blockingReason)) && (
    <div className="airo-input-secrets-form__toolbar-messages">
      {helperText && (
        <text.span
          as="caption"
          size={-2}
          emphasis="passive"
          id={helperTextId}
          className="airo-input-secrets-form__helper-text"
        >
          {helperText}
        </text.span>
      )}
      {showValidationError && blockingReason && (
        <output id={errorId} aria-live="polite" className="airo-input-secrets-form__error-text">
          <text.span as="caption" size={-2} emphasis="critical">
            {blockingReason}
          </text.span>
        </output>
      )}
    </div>
  );

  if (dismissedAfterSubmit) {
    return null;
  }

  return (
    <Box
      displayType="flex"
      orientation="vertical"
      // `borderless` drops the raised elevation (and its shadow) so the
      // form sits flush inside whatever host surface provides chrome.
      elevation={borderless ? 'base' : isComposer ? 'raised' : 'base'}
      className={classnames(
        'airo-input-secrets-form',
        !isComposer && 'airo-input-secrets-form--conversation',
        borderless && 'airo-input-secrets-form--borderless',
        className,
      )}
      {...rest}
    >
      {/* Header: title (h3) + field label; composer adds close (X). */}
      <div
        className={classnames(
          'airo-input-secrets-form__header',
          !isComposer && 'airo-input-secrets-form__header--conversation',
        )}
      >
        <div className="airo-input-secrets-form__header-text">
          <div className="airo-input-secrets-form__eyebrow-row">
            <span className="airo-input-secrets-form__secret-lock" aria-hidden="true">
              <AsyncIcon icon="locked" />
            </span>
            <text.h3 as="caption" size={-2} className="airo-input-secrets-form__eyebrow">
              {eyebrow}
            </text.h3>
          </div>
          <text.label
            as="paragraph"
            size={-1}
            id={labelId}
            htmlFor={entryId}
            className="airo-input-secrets-form__label"
          >
            {label}
          </text.label>
        </div>
        {isComposer ? (
          <Button
            design="inline"
            size="small"
            className="airo-input-secrets-form__chrome-button"
            icon={<AsyncIcon icon="x" />}
            aria-label={closeLabel}
            onClick={onClose}
          />
        ) : null}
      </div>

      {/* Single-line @ux/text-entry — omit `multiline` so `type`/`password` narrow on `TextEntryProps`; runtime is still `<input>` (falsy `multiline`). */}
      <div className="airo-input-secrets-form__input-area">
        <TextEntry
          // @ux/text-entry types `ref` as input ∩ textarea; single-line runtime is always an `<input>`.
          ref={ref as never}
          id={entryId}
          stretch
          visualSize="sm"
          value={currentValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={showValidationError}
          invalid={showValidationError}
          type={visible && hasValue ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          maxLength={maxLength}
          className={classnames('airo-input-secrets-form__entry', {
            'airo-input-secrets-form__entry--plaintext-visible': visible && hasValue,
          })}
        />
        {hasValue && (
          <Button
            design="inline"
            size="small"
            icon={<AsyncIcon icon={visible ? 'hide' : 'show'} />}
            aria-label={visible ? hideSecretLabel : showSecretLabel}
            onClick={toggleVisibility}
            className={classnames(
              'airo-input-secrets-form__visibility-toggle',
              'airo-input-secrets-form__chrome-button',
            )}
          />
        )}
      </div>

      {isComposer ? (
        <div className="airo-input-secrets-form__toolbar">
          {messagesSlot}
          <span
            className="airo-input-secrets-form__submit"
            data-partial={pending ? undefined : 'componentAiro'}
          >
            <Button
              design="primary"
              size="small"
              className="airo-input-secrets-form__chrome-button"
              icon={<AsyncIcon icon="arrow-up" />}
              aria-label={effectiveSubmitLabel}
              onClick={handleSubmit}
              disabled={cannotSubmit}
            />
          </span>
        </div>
      ) : (
        <>
          {messagesSlot && (
            <div className="airo-input-secrets-form__conversation-messages">{messagesSlot}</div>
          )}
          <div className="airo-input-secrets-form__conversation-footer">
            <Button
              design="primary"
              size="small"
              type="button"
              className="airo-input-secrets-form__chrome-button"
              text={effectiveSubmitLabel}
              onClick={handleSubmit}
              disabled={cannotSubmit}
            />
            {onClose && (
              <Button
                design="secondary"
                size="small"
                type="button"
                className="airo-input-secrets-form__chrome-button"
                text={cancelLabel}
                onClick={onClose}
              />
            )}
          </div>
        </>
      )}
    </Box>
  );
}

/**
 * Inline secret-input card for conversational AI interfaces. See {@link SecretsFormProps}
 * for `variant` (`composer` vs `conversation`) and the full API.
 *
 * @example
 * ```tsx
 * import { SecretsForm } from '@airo-ux/pattern-library/input/secrets-form';
 * import '@airo-ux/pattern-library/input/secrets-form/styles';
 *
 * <SecretsForm
 *   label="DISCOGS_TOKEN:"
 *   helperText="Token from your provider’s developer settings"
 *   onSubmit={(value) => {
 *     void saveSecret(value);
 *   }}
 *   onClose={() => {
 *     dismissSecretPrompt();
 *   }}
 * />
 * ```
 *
 * After **`onSubmit`** finishes successfully (when provided; sync or resolved **`Promise`**), this instance renders **`null`** until remounted. Omitting **`onSubmit`** leaves valid submits as a no-op (form stays mounted). **`variant="composer"`** requires **`onClose`** so the header **X** can reject the prompt without submitting.
 *
 * @see ./README.md
 */
export const SecretsForm = forwardRef<HTMLInputElement, SecretsFormProps>(SecretsFormRoot);
