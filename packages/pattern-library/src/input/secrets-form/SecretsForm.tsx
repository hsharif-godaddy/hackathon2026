import Box from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';
import Tooltip from '@ux/tooltip';
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

import { SecretsTakeoverField } from './SecretsTakeoverField';

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
 * Optional info icon with tooltip next to the title.
 */
export type SecretsFormInfoButton = {
  /** Text content for the tooltip. */
  tooltipText: string;
  /** Accessible label for the info icon button. @default "More information" */
  ariaLabel?: string;
};

/**
 * Definition for a single secret field in multi-field mode.
 */
export type SecretFieldDefinition = {
  /** Secret name (e.g. "STRIPE_SECRET_KEY") - used as the key in the submitted values object */
  name: string;
  /** Display label. When omitted, uses `name` with a trailing colon. */
  label?: string;
  /** Help text shown below this specific field. */
  helperText?: string;
  /** Placeholder for this field's input. @default "Enter value" */
  placeholder?: string;
  /** Initial value in uncontrolled mode. @default "" */
  defaultValue?: string;
  /** Whether this field is required. @default true */
  required?: boolean;
};

/**
 * Optional step indicator for multi-secret flows (e.g. 1/3).
 */
export type SecretsFormStepIndicator = {
  current: number;
  total: number;
};

/**
 * Base props shared across all SecretsForm variants.
 */
interface SecretsFormBaseProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange' | 'onSubmit'> {
  /**
   * Title line above the secret name (e.g. **"New Secret"**). Rendered as an **`h3`**
   * with caption-scale typography so the card has a proper document heading — use **title
   * case** and **no terminal period** (short heading, not body eyebrow copy).
   * @default "New Secret"
   */
  eyebrow?: string;

  /**
   * Supplementary copy for the field (e.g. where to get the token).
   * **`variant="composer"`:** shown in the **bottom toolbar** (same row as send).
   * **`variant="conversation"`:** shown **below the input** in the stacked messages area
   * (with validation), not in a toolbar row.
   */
  helperText?: string;

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
   * When set, disables header close / cancel independently of {@link pending}.
   * Defaults to {@link pending} when omitted (e.g. block close only during save).
   */
  closePending?: boolean;

  /* ========== Shared validation/behavior props ========== */

  /**
   * Minimum **trimmed** length required before submit. Empty / whitespace-only
   * values never submit when this is at least `1` (default).
   * **Multi-field mode:** Applies to all required fields.
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
   * Visible label (text button) or accessible name (composer icon-only submit).
   * Required — the host must pass a translated string (e.g. i18n `builder_common_save`).
   */
  submitLabel: string;
  /** Accessible label for the header close button (`variant="composer"` only). @default "Close" */
  closeLabel?: string;
  /** Visible label for the cancel button (`variant="conversation"` only). @default "Cancel" */
  cancelLabel?: string;
  /** Accessible label for the back control (`variant="conversation"` only). @default "Back" */
  backLabel?: string;
  /**
   * When set, shows a back chevron in the conversation footer (e.g. paginated multi-secret flows).
   */
  onBack?: () => void;
  /**
   * When `false`, a successful submit keeps the form mounted (e.g. wizard Continue steps).
   * @default true
   */
  dismissOnSubmit?: boolean;
  /** Accessible label for the show-secret control when the field has a value. @default "Show value" */
  showSecretLabel?: string;
  /** Accessible label for the hide-secret control when the field has a value. @default "Hide value" */
  hideSecretLabel?: string;
  /**
   * Overrides for built-in validation strings (e.g. i18n). Defaults are English.
   */
  validationMessages?: Partial<SecretsFormValidationMessages>;
  /**
   * Optional info icon with tooltip next to the title. When provided, displays
   * an info icon button that shows the tooltip text on click.
   */
  infoButton?: SecretsFormInfoButton;
  /**
   * When set with `total` > 1, shows a paginated step indicator (e.g. `1/3`)
   * in the header — same affordance as multi-step `ChoiceList`.
   */
  stepIndicator?: SecretsFormStepIndicator;
  /**
   * Formats the step indicator label. @default `(current, total) => \`${current}/${total}\``
   */
  stepIndicatorLabel?: (current: number, total: number) => string;
  /**
   * When `true`, strips the form’s outer card chrome (background, border,
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
  /**
   * Optional error handler called when `onSubmit` / `onSubmitMulti` / `onComplete`
   * rejects. Use this in hosts that need custom error logging or user feedback.
   * In-app the error is already surfaced via persist’s Growl + rethrow, so this
   * is library-robustness for other hosts.
   */
  onError?: (error: unknown) => void;
}

/**
 * Single-field mode props.
 */
interface SecretsFormSingleFieldProps {
  /**
   * **Single-field mode:** Secret name shown in the header (e.g. "DISCOGS_TOKEN:").
   * Rendered as a **`<label htmlFor={…}>`** for the password field.
   */
  label: string;
  /**
   * Controlled value of the password field. When provided the component
   * is fully controlled — the caller must update it on every `onChange`.
   * Omit to use uncontrolled mode with an optional `defaultValue`.
   */
  value?: string;
  /**
   * Initial value in uncontrolled mode. @default ""
   */
  defaultValue?: string;
  /**
   * Called on every keystroke with the new field value.
   */
  onChange?: (value: string) => void;
  /**
   * **Single-field mode:** Called with the trimmed value when the user clicks send/save or presses Enter.
   */
  onSubmit?: (value: string) => void | Promise<void>;
  // Exclude multi-field props to make union discriminated
  fields?: never;
  values?: never;
  onValuesChange?: never;
  onSubmitMulti?: never;
}

/**
 * Multi-field mode props.
 */
interface SecretsFormMultiFieldProps {
  /**
   * **Multi-field mode:** Array of secret field definitions. When provided, renders
   * stacked password fields (e.g. for Stripe: SECRET_KEY + PUBLISHABLE_KEY).
   * Maximum 3 fields recommended for composer slot height.
   */
  fields: SecretFieldDefinition[];
  /**
   * **Multi-field mode:** Controlled values object mapping field names to current values.
   * When provided, component is fully controlled — caller must update on every change.
   * Omit for uncontrolled mode (each field manages its own state from `defaultValue`).
   */
  values?: Record<string, string>;
  /**
   * **Multi-field mode:** Called on every keystroke in any field with the full values object.
   * `changedField` indicates which field triggered the change.
   */
  onValuesChange?: (values: Record<string, string>, changedField: string) => void;
  /**
   * **Multi-field mode:** Called with **`Record<string, string>`** mapping field names to trimmed values
   * when the user clicks send/save or presses Enter.
   */
  onSubmitMulti?: (values: Record<string, string>) => void | Promise<void>;
  // Exclude single-field props to make union discriminated
  label?: never;
  value?: never;
  defaultValue?: string; // Keep this - multi-field uses it for field.defaultValue
  onChange?: never;
  onSubmit?: never;
}

/**
 * Composer variant props wrapper.
 */
interface SecretsFormComposerVariantProps {
  variant?: 'composer';
  onClose: () => void;
}

/**
 * Conversation variant props wrapper.
 */
interface SecretsFormConversationVariantProps {
  variant: 'conversation';
  onClose?: () => void;
}

/**
 * SecretsForm in composer variant (default) — replaces the chat input.
 * Header close button is always shown; onClose is required so the user can reject
 * the agent’s request without submitting a value.
 */
export type SecretsFormComposerProps =
  | (SecretsFormBaseProps & SecretsFormSingleFieldProps & SecretsFormComposerVariantProps)
  | (SecretsFormBaseProps & SecretsFormMultiFieldProps & SecretsFormComposerVariantProps);

/**
 * SecretsForm in conversation variant — in-thread card. Cancel is shown
 * only when onClose is provided.
 */
export type SecretsFormConversationProps =
  | (SecretsFormBaseProps & SecretsFormSingleFieldProps & SecretsFormConversationVariantProps)
  | (SecretsFormBaseProps & SecretsFormMultiFieldProps & SecretsFormConversationVariantProps);

/** Public props — **`onClose`** is required in **`composer`**, optional in **`conversation`**. */
export type SecretsFormProps = SecretsFormComposerProps | SecretsFormConversationProps;

function SecretsFormRoot(props: SecretsFormProps, ref: Ref<HTMLInputElement>) {
  // Extract all props including mode-specific ones
  const {
    className,
    variant = 'composer',
    eyebrow = 'New Secret',
    helperText,
    placeholder = 'Enter value',
    pending = false,
    closePending,
    minLength = 1,
    maxLength,
    validate,
    onClose,
    submitLabel,
    closeLabel = 'Close',
    cancelLabel = 'Cancel',
    backLabel = 'Back',
    onBack,
    dismissOnSubmit = true,
    showSecretLabel = 'Show value',
    hideSecretLabel = 'Hide value',
    validationMessages,
    infoButton,
    borderless = false,
    stepIndicator,
    stepIndicatorLabel = (current: number, total: number) => `${current}/${total}`,
    onError,
  } = props;

  // Type-safe extraction of mode-specific props using discriminant checks
  const label = 'label' in props ? props.label : undefined;
  const value = 'value' in props ? props.value : undefined;
  const defaultValue = 'defaultValue' in props ? props.defaultValue : undefined;
  const onChange = 'onChange' in props ? props.onChange : undefined;
  const onSubmit = 'onSubmit' in props ? props.onSubmit : undefined;
  const fields = 'fields' in props ? props.fields : undefined;
  const values = 'values' in props ? props.values : undefined;
  const onValuesChange = 'onValuesChange' in props ? props.onValuesChange : undefined;
  const onSubmitMulti = 'onSubmitMulti' in props ? props.onSubmitMulti : undefined;

  // Extract rest HTML attributes (exclude all component-specific props)
  const {
    variant: _v,
    eyebrow: _e,
    helperText: _h,
    placeholder: _p,
    pending: _pd,
    closePending: _cpd,
    minLength: _min,
    maxLength: _max,
    validate: _vd,
    onClose: _ocl,
    submitLabel: _sl,
    closeLabel: _cl,
    cancelLabel: _cnl,
    backLabel: _bl,
    onBack: _ob,
    dismissOnSubmit: _dos,
    showSecretLabel: _ssl,
    hideSecretLabel: _hsl,
    validationMessages: _vm,
    infoButton: _ib,
    borderless: _b,
    stepIndicator: _si,
    stepIndicatorLabel: _sil,
    onError: _oer,
    label: _l,
    value: _val,
    defaultValue: _dv,
    onChange: _oc,
    onSubmit: _os,
    fields: _f,
    values: _vals,
    onValuesChange: _ovc,
    onSubmitMulti: _osm,
    className: _cn,
    ...rest
  } = props as SecretsFormProps & Record<string, unknown>;

  // Mode detection
  const isMultiField = Boolean(fields && fields.length > 0);
  const isComposer = variant === 'composer';
  const useComposerTextInput = isComposer && !isMultiField;
  const entryId = useId();
  const labelId = useId();
  const helperTextId = useId();
  const errorId = useId();

  // Single-field state
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const [visible, setVisible] = useState(false);

  // Multi-field state
  const isMultiControlled = values !== undefined;
  const [internalValues, setInternalValues] = useState<Record<string, string>>(() => {
    if (!fields) return {};
    return fields.reduce((acc: Record<string, string>, field: SecretFieldDefinition) => {
      acc[field.name] = field.defaultValue ?? '';
      return acc;
    }, {} as Record<string, string>);
  });
  const [visibleFields, setVisibleFields] = useState<Record<string, boolean>>({});

  // Shared state
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [dismissedAfterSubmit, setDismissedAfterSubmit] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  /** Blocks duplicate submit while `onSubmit` is awaited (before host can set `pending`). */
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const submitInFlightRef = useRef(false);
  /** Cleared on unmount so async `onSubmit` completion does not call `setState` after teardown. */
  const mountedRef = useRef(true);
  const infoButtonRef = useRef<HTMLButtonElement>(null);

  // Single-field derived values
  const currentValue = isControlled
    ? String(value ?? '')
    : internalValue;
  const hasValue = currentValue.length > 0;
  const trimmedValue = currentValue.trim();

  // Multi-field derived values
  const currentValues = isMultiControlled ? values ?? {} : internalValues;

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

  // Single-field validation
  const blockingReason = useMemo(
    function computeBlockingReason() {
      if (isMultiField) return undefined; // Multi-field validation is per-field
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
    [isMultiField, currentValue, trimmedValue, minLength, maxLength, validate, resolvedValidationMessages],
  );

  // Multi-field validation: check if any required field is invalid
  const multiFieldBlockingReason = useMemo(
    function computeMultiFieldBlocking() {
      if (!isMultiField || !fields) return undefined;
      for (const field of fields) {
        const fieldValue = currentValues[field.name] ?? '';
        const trimmed = fieldValue.trim();
        const isRequired = field.required !== false;
        if (isRequired && trimmed.length < minLength) {
          return `All required fields must be filled.`;
        }
      }
      return undefined;
    },
    [isMultiField, fields, currentValues, minLength],
  );

  const effectiveBlockingReason = isMultiField ? multiFieldBlockingReason : blockingReason;
  const cannotSubmit = Boolean(pending || effectiveBlockingReason || submitInFlight);
  const isClosePending = closePending ?? pending;

  const hasMultiFieldInteraction = Boolean(
    isMultiField &&
      fields?.some(function fieldHasInput(field) {
        return (currentValues[field.name] ?? '').length > 0;
      }),
  );

  const showValidationError = Boolean(
    effectiveBlockingReason &&
      (submitAttempted ||
        (isMultiField
          ? hasMultiFieldInteraction
          : trimmedValue.length > 0 || (hasValue && trimmedValue.length === 0))),
  );

  useEffect(
    function clearSubmitAttemptWhenValid() {
      if (!effectiveBlockingReason) setSubmitAttempted(false);
    },
    [effectiveBlockingReason],
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

  const handleMultiFieldChange = useCallback(
    function changeMultiField(fieldName: string, next: string | number) {
      const s = String(next);
      const nextValues = { ...currentValues, [fieldName]: s };
      if (!isMultiControlled) setInternalValues(nextValues);
      onValuesChange?.(nextValues, fieldName);
    },
    [currentValues, isMultiControlled, onValuesChange],
  );

  const handleSubmit = useCallback(
    async function submit() {
      if (dismissedAfterSubmit) return;
      if (pending) return;
      if (submitInFlightRef.current) return;
      if (effectiveBlockingReason) {
        setSubmitAttempted(true);
        return;
      }
      submitInFlightRef.current = true;
      setSubmitInFlight(true);

      // Multi-field mode
      if (isMultiField && onSubmitMulti) {
        const trimmedValues: Record<string, string> = {};
        if (fields) {
          for (const field of fields) {
            const raw = currentValues[field.name] ?? '';
            trimmedValues[field.name] = raw.trim();
          }
        }
        try {
          await Promise.resolve(onSubmitMulti(trimmedValues));
        } catch (error: unknown) {
          onError?.(error);
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
        if (!dismissOnSubmit) {
          submitInFlightRef.current = false;
          setSubmitInFlight(false);
          return;
        }
        if (!isMultiControlled) setInternalValues({});
        setVisibleFields({});
        setDismissedAfterSubmit(true);
        submitInFlightRef.current = false;
        setSubmitInFlight(false);
        return;
      }

      // Single-field mode
      if (!onSubmit) {
        submitInFlightRef.current = false;
        setSubmitInFlight(false);
        return;
      }
      try {
        await Promise.resolve(onSubmit(trimmedValue));
      } catch (error: unknown) {
        onError?.(error);
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
      if (!dismissOnSubmit) {
        submitInFlightRef.current = false;
        setSubmitInFlight(false);
        return;
      }
      if (!isControlled) setInternalValue('');
      setVisible(false);
      setDismissedAfterSubmit(true);
      submitInFlightRef.current = false;
      setSubmitInFlight(false);
    },
    [
      dismissedAfterSubmit,
      pending,
      effectiveBlockingReason,
      dismissOnSubmit,
      isMultiField,
      fields,
      currentValues,
      onSubmitMulti,
      isMultiControlled,
      trimmedValue,
      onSubmit,
      isControlled,
    ],
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

  const toggleFieldVisibility = useCallback(function toggleField(fieldName: string) {
    setVisibleFields((prev) => ({ ...prev, [fieldName]: !prev[fieldName] }));
  }, []);

  const describedBy =
    [helperText && helperTextId, showValidationError && errorId].filter(Boolean).join(' ') ||
    undefined;

  const messagesSlot = (helperText || (showValidationError && effectiveBlockingReason)) && (
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
      {showValidationError && effectiveBlockingReason && (
        <output id={errorId} aria-live="polite" className="airo-input-secrets-form__error-text">
          <text.span as="caption" size={-2} emphasis="critical">
            {effectiveBlockingReason}
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
            {infoButton && (
              <>
                <Button
                  ref={infoButtonRef}
                  design="inline"
                  size="small"
                  className="airo-input-secrets-form__chrome-button airo-input-secrets-form__info-button"
                  icon={<AsyncIcon icon="information" />}
                  aria-label={infoButton.ariaLabel ?? 'More information'}
                  onClick={() => setTooltipOpen((prev) => !prev)}
                />
                <Tooltip
                  anchorRef={infoButtonRef}
                  open={tooltipOpen}
                  onClose={() => setTooltipOpen(false)}
                  placement="bottom"
                  style={{ maxWidth: 'min(400px, 80vw)' }}
                >
                  {infoButton.tooltipText}
                </Tooltip>
              </>
            )}
          </div>
          {!isMultiField && !useComposerTextInput && label ? (
            <text.label
              as="paragraph"
              size={-1}
              id={labelId}
              htmlFor={entryId}
              className="airo-input-secrets-form__label"
            >
              {label}
            </text.label>
          ) : null}
        </div>
        {stepIndicator && stepIndicator.total > 1 ? (
          <text.span
            as="caption"
            size={-2}
            emphasis="passive"
            className="airo-input-secrets-form__step-indicator"
            aria-live="polite"
          >
            {stepIndicatorLabel(stepIndicator.current, stepIndicator.total)}
          </text.span>
        ) : null}
        {isComposer ? (
          <Button
            design="inline"
            size="small"
            className="airo-input-secrets-form__chrome-button"
            icon={<AsyncIcon icon="x" />}
            aria-label={closeLabel}
            disabled={isClosePending || submitInFlight}
            onClick={onClose}
          />
        ) : null}
      </div>

      {!isMultiField && useComposerTextInput && label ? (
        <SecretsTakeoverField
          ref={ref}
          entryId={entryId}
          label={label}
          labelId={labelId}
          value={currentValue}
          placeholder={placeholder}
          helperText={helperText}
          helperTextId={helperTextId}
          errorId={errorId}
          blockingReason={blockingReason}
          showValidationError={showValidationError}
          visible={visible}
          hasValue={hasValue}
          hideSecretLabel={hideSecretLabel}
          showSecretLabel={showSecretLabel}
          maxLength={maxLength}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onToggleVisibility={toggleVisibility}
        />
      ) : null}

      {/* Single-field conversation / legacy row: @ux/text-entry */}
      {!isMultiField && !useComposerTextInput ? (
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
      ) : null}

      {/* Multi-field mode: stacked password fields */}
      {isMultiField && fields && (
        <div className="airo-input-secrets-form__multi-field-container">
          {fields.map((field: SecretFieldDefinition) => {
            const fieldValue = currentValues[field.name] ?? '';
            const fieldHasValue = fieldValue.length > 0;
            const fieldVisible = visibleFields[field.name] ?? false;
            const fieldLabel = field.label ?? `${field.name}:`;
            const fieldPlaceholder = field.placeholder ?? placeholder;
            const fieldId = `${entryId}-${field.name}`;
            const fieldLabelId = `${labelId}-${field.name}`;
            const fieldHelperTextId = field.helperText ? `${helperTextId}-${field.name}` : undefined;

            return (
              <div key={field.name} className="airo-input-secrets-form__field-row">
                <text.label
                  as="paragraph"
                  size={-1}
                  id={fieldLabelId}
                  htmlFor={fieldId}
                  className="airo-input-secrets-form__field-label"
                >
                  {fieldLabel}
                </text.label>
                <div className="airo-input-secrets-form__input-area">
                  <TextEntry
                    id={fieldId}
                    stretch
                    visualSize="sm"
                    value={fieldValue}
                    onChange={(next: string | number) => handleMultiFieldChange(field.name, next)}
                    onKeyDown={handleKeyDown}
                    placeholder={fieldPlaceholder}
                    aria-describedby={fieldHelperTextId}
                    type={fieldVisible && fieldHasValue ? 'text' : 'password'}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={maxLength}
                    // className={classnames('airo-input-secrets-form__entry', {
                    //   'airo-input-secrets-form__entry--plaintext-visible': fieldVisible && fieldHasValue,
                    // })}
                  />
                  {fieldHasValue && (
                    <Button
                      design="inline"
                      size="small"
                      icon={<AsyncIcon icon={fieldVisible ? 'hide' : 'show'} />}
                      aria-label={fieldVisible ? hideSecretLabel : showSecretLabel}
                      onClick={() => toggleFieldVisibility(field.name)}
                      className={classnames(
                        'airo-input-secrets-form__visibility-toggle',
                        'airo-input-secrets-form__chrome-button',
                      )}
                    />
                  )}
                </div>
                {field.helperText && (
                  <text.span
                    as="caption"
                    size={-2}
                    emphasis="passive"
                    id={fieldHelperTextId}
                    className="airo-input-secrets-form__field-helper-text"
                  >
                    {field.helperText}
                  </text.span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isComposer ? (
        useComposerTextInput ? (
          <div className="airo-input-secrets-form__takeover-footer">
            <span className="airo-input-secrets-paginated-form__footer-actions">
              <Button
                design="primary"
                size="small"
                type="button"
                className="airo-input-secrets-form__chrome-button"
                text={submitLabel}
                onClick={handleSubmit}
                disabled={cannotSubmit}
              />
            </span>
          </div>
        ) : (
          <div className="airo-input-secrets-form__toolbar">
            {!useComposerTextInput ? messagesSlot : null}
            <span
              className="airo-input-secrets-form__submit"
              data-partial={pending ? undefined : 'componentAiro'}
            >
              <Button
                design="primary"
                size="small"
                className="airo-input-secrets-form__chrome-button"
                icon={<AsyncIcon icon="arrow-up" />}
                aria-label={submitLabel}
                onClick={handleSubmit}
                disabled={cannotSubmit}
              />
            </span>
          </div>
        )
      ) : (
        <>
          {messagesSlot && (
            <div className="airo-input-secrets-form__conversation-messages">{messagesSlot}</div>
          )}
          <div className="airo-input-secrets-form__conversation-footer">
            {onBack ? (
              <Button
                design="inline"
                size="small"
                type="button"
                className="airo-input-secrets-form__chrome-button"
                aria-label={backLabel}
                onClick={onBack}
                icon={<AsyncIcon icon="chevron-left" />}
              />
            ) : null}
            <div className="airo-input-secrets-form__conversation-footer-actions">
              <Button
                design="primary"
                size="small"
                type="button"
                className="airo-input-secrets-form__chrome-button"
                text={submitLabel}
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
                  disabled={isClosePending || submitInFlight}
                  onClick={onClose}
                />
              )}
            </div>
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
