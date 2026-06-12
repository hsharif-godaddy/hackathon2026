import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import TextEntry from '@ux/text-entry';
import classnames from 'classnames';
import {
  Children,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type ReactNode,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SecretsTakeoverField } from './SecretsTakeoverField';
import {
  SecretsPaginatedFormStep,
  type SecretsPaginatedFormStepProps,
} from './SecretsPaginatedFormStep';

export interface SecretsPaginatedFormStepDefinition {
  id: string;
  title?: ReactNode;
  label: string;
  helperText?: string;
  placeholder: string;
  required: boolean;
}

function isSecretsPaginatedFormStepType(type: unknown): boolean {
  if (type === SecretsPaginatedFormStep) {
    return true;
  }
  if (typeof type === 'function') {
    const named = type as { displayName?: string; name?: string };
    return named.displayName === 'SecretsPaginatedFormStep' || named.name === 'SecretsPaginatedFormStep';
  }
  return false;
}

function collectSteps(children: ReactNode): SecretsPaginatedFormStepDefinition[] {
  const steps: SecretsPaginatedFormStepDefinition[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (!isSecretsPaginatedFormStepType(child.type)) return;
    const props = child.props as SecretsPaginatedFormStepProps;
    if (!props.id) return;
    steps.push({
      id: props.id,
      title: props.title,
      label: props.label ?? `${props.id}:`,
      helperText: props.helperText,
      placeholder: props.placeholder ?? 'Enter value',
      required: props.required !== false,
    });
  });
  return steps;
}

export interface SecretsPaginatedFormProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  hideStepTitle?: boolean;
  pending?: boolean;
  /** When set, disables header close / cancel independently of {@link pending}. */
  closePending?: boolean;
  /** Required — host passes translated label (e.g. i18n `builder_common_next`). */
  continueLabel: string;
  /** Required — host passes translated label (e.g. i18n `builder_common_save`). */
  saveLabel: string;
  cancelLabel?: string;
  backLabel?: string;
  forwardLabel?: string;
  stepIndicatorLabel?: (current: number, total: number) => string;
  onComplete?: (values: Record<string, string>) => void | Promise<void>;
  onActiveStepChange?: (stepId: string, index: number) => void;
  onClose?: () => void;
  /** Composer takeover: header row with lock + eyebrow + **X** (hides footer Cancel). */
  showHeaderClose?: boolean;
  headerEyebrow?: ReactNode;
  /** Accessible label for the header **X**. @default "Close" */
  closeLabel?: string;
  /**
   * Step definitions when not using {@link SecretsPaginatedFormStep} children.
   * Prefer this in app hosts so bundlers cannot duplicate the virtual Step component.
   */
  steps?: SecretsPaginatedFormStepDefinition[];
  children?: ReactNode;
  /**
   * Optional error handler called when `onComplete` rejects. Use this in hosts
   * that need custom error logging or user feedback. In-app the error is already
   * surfaced via persist's Growl + rethrow, so this is library-robustness for other hosts.
   */
  onError?: (error: unknown) => void;
}

function SecretsPaginatedFormRoot({
  hideStepTitle = false,
  pending = false,
  closePending,
  continueLabel,
  saveLabel,
  cancelLabel = 'Cancel',
  backLabel = 'Previous step',
  forwardLabel = 'Next step',
  stepIndicatorLabel = (current: number, total: number) => `${current}/${total}`,
  onError,
  onComplete,
  onActiveStepChange,
  onClose,
  showHeaderClose = false,
  headerEyebrow,
  closeLabel = 'Close',
  steps: stepsProp,
  children,
  className,
  ...rest
}: SecretsPaginatedFormProps) {
  const steps = useMemo(
    function resolveSteps() {
      if (stepsProp?.length) {
        return stepsProp;
      }
      return collectSteps(children);
    },
    [stepsProp, children],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [draft, setDraft] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [submitInFlight, setSubmitInFlight] = useState(false);
  const valuesRef = useRef<Record<string, string>>({});
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const onActiveStepChangeRef = useRef(onActiveStepChange);
  onActiveStepChangeRef.current = onActiveStepChange;

  const activeStep = steps[stepIndex];
  const stepTotal = steps.length;
  const isLastStep = stepIndex >= stepTotal - 1;
  const entryId = useId();
  const helperTextId = useId();
  const errorId = useId();
  const useComposerTextInput = showHeaderClose;
  const trimmedDraft = draft.trim();
  const hasValue = draft.length > 0;
  const blockingReason =
    activeStep?.required && trimmedDraft.length < 1 ? 'Enter a value.' : undefined;
  const cannotSubmit = Boolean(pending || blockingReason || submitInFlight);
  const isClosePending = closePending ?? pending;
  const showValidationError = Boolean(
    blockingReason &&
      (submitAttempted || trimmedDraft.length > 0 || (hasValue && trimmedDraft.length === 0)),
  );

  useEffect(function trackMounted() {
    mountedRef.current = true;
    return function cleanup() {
      mountedRef.current = false;
    };
  }, []);

  useEffect(
    function restoreDraftOnStepChange() {
      if (!activeStep) return;
      setDraft(valuesRef.current[activeStep.id] ?? '');
      setVisible(false);
      setSubmitAttempted(false);
    },
    [activeStep?.id],
  );

  useEffect(
    function resetVisibilityWhenEmpty() {
      if (!hasValue) setVisible(false);
    },
    [hasValue],
  );

  useEffect(
    function notifyActiveStep() {
      if (!activeStep) return;
      onActiveStepChangeRef.current?.(activeStep.id, stepIndex);
    },
    [activeStep?.id, stepIndex],
  );

  const commitStep = useCallback(
    async function commitStep() {
      if (!activeStep || dismissed) return;
      if (pending || submitInFlightRef.current) return;
      if (blockingReason) {
        setSubmitAttempted(true);
        return;
      }

      submitInFlightRef.current = true;
      setSubmitInFlight(true);
      valuesRef.current = { ...valuesRef.current, [activeStep.id]: trimmedDraft };

      if (!isLastStep) {
        submitInFlightRef.current = false;
        setSubmitInFlight(false);
        setDirection('forward');
        setStepIndex((index) => Math.min(stepTotal - 1, index + 1));
        return;
      }

      try {
        await Promise.resolve(onComplete?.(valuesRef.current));
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

      setDismissed(true);
      submitInFlightRef.current = false;
      setSubmitInFlight(false);
    },
    [activeStep, blockingReason, dismissed, isLastStep, onComplete, onError, pending, stepTotal, trimmedDraft],
  );

  const back = useCallback(
    function back() {
      if (!activeStep || pending || stepIndex === 0) return;
      valuesRef.current = { ...valuesRef.current, [activeStep.id]: draft };
      setDirection('back');
      setStepIndex((index) => Math.max(0, index - 1));
    },
    [activeStep, draft, pending, stepIndex],
  );

  const forward = useCallback(
    function forward() {
      if (!activeStep || pending || isLastStep) return;
      void commitStep();
    },
    [activeStep, commitStep, isLastStep, pending],
  );

  const handleKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
    function keyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void commitStep();
      }
    },
    [commitStep],
  );

  if (!steps.length || dismissed || !activeStep) {
    return null;
  }

  const effectiveSubmitLabel = isLastStep ? saveLabel : continueLabel;
  const describedBy =
    [activeStep.helperText && helperTextId, showValidationError && errorId]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div
      className={classnames(
        'airo-input-secrets-paginated-form',
        pending && 'airo-input-secrets-paginated-form--pending',
        showHeaderClose && 'airo-input-secrets-form--borderless',
        showHeaderClose && 'airo-input-secrets-form--takeover',
        className,
      )}
      {...rest}
    >
      {showHeaderClose && onClose ? (
        <div className="airo-input-secrets-form__header">
          <div className="airo-input-secrets-form__header-text">
            <div className="airo-input-secrets-form__eyebrow-row">
              <span className="airo-input-secrets-form__secret-lock" aria-hidden="true">
                <AsyncIcon icon="locked" />
              </span>
              {headerEyebrow != null && headerEyebrow !== '' ? (
                <text.h3 as="caption" size={-2} className="airo-input-secrets-form__eyebrow">
                  {headerEyebrow}
                </text.h3>
              ) : null}
            </div>
          </div>
          <Button
            design="inline"
            size="small"
            className="airo-input-secrets-form__chrome-button"
            icon={<AsyncIcon icon="x" />}
            aria-label={closeLabel}
            disabled={isClosePending || submitInFlight}
            onClick={onClose}
          />
        </div>
      ) : null}
      <div
        key={activeStep.id}
        className={classnames(
          'airo-input-secrets-paginated-form__step',
          direction === 'forward'
            ? 'airo-input-secrets-paginated-form__step--enter-forward'
            : 'airo-input-secrets-paginated-form__step--enter-back',
        )}
      >
        {!hideStepTitle && activeStep.title != null && !useComposerTextInput ? (
          <text.h3 as="caption" size={-1} className="airo-input-secrets-paginated-form__title">
            {activeStep.title}
          </text.h3>
        ) : null}

        {useComposerTextInput ? (
          <SecretsTakeoverField
            entryId={entryId}
            label={activeStep.label}
            value={draft}
            placeholder={activeStep.placeholder}
            helperText={activeStep.helperText}
            helperTextId={helperTextId}
            errorId={errorId}
            blockingReason={blockingReason}
            showValidationError={showValidationError}
            visible={visible}
            hasValue={hasValue}
            onChange={(next: string | number) => setDraft(String(next))}
            onKeyDown={handleKeyDown}
            onToggleVisibility={() => setVisible((value) => !value)}
          />
        ) : (
          <>
            <text.label
              as="paragraph"
              size={-1}
              htmlFor={entryId}
              className="airo-input-secrets-paginated-form__label"
            >
              {activeStep.label}
            </text.label>

            <div className="airo-input-secrets-paginated-form__input-area">
              <TextEntry
                id={entryId}
                stretch
                visualSize="sm"
                value={draft}
                onChange={(next: string | number) => setDraft(String(next))}
                onKeyDown={handleKeyDown}
                placeholder={activeStep.placeholder}
                aria-describedby={describedBy}
                aria-invalid={showValidationError}
                invalid={showValidationError}
                type={visible && hasValue ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                className={classnames('airo-input-secrets-paginated-form__entry', {
                  'airo-input-secrets-paginated-form__entry--plaintext-visible': visible && hasValue,
                })}
              />
              {hasValue ? (
                <Button
                  design="inline"
                  size="small"
                  icon={<AsyncIcon icon={visible ? 'hide' : 'show'} />}
                  aria-label={visible ? 'Hide value' : 'Show value'}
                  onClick={() => setVisible((value) => !value)}
                  className="airo-input-secrets-paginated-form__visibility-toggle"
                />
              ) : null}
            </div>

            {(activeStep.helperText || showValidationError) && (
              <div className="airo-input-secrets-paginated-form__messages">
                {activeStep.helperText ? (
                  <text.span
                    as="caption"
                    size={-2}
                    emphasis="passive"
                    id={helperTextId}
                    className="airo-input-secrets-paginated-form__helper-text"
                  >
                    {activeStep.helperText}
                  </text.span>
                ) : null}
                {showValidationError && blockingReason ? (
                  <output
                    id={errorId}
                    aria-live="polite"
                    className="airo-input-secrets-paginated-form__error-text"
                  >
                    <text.span as="caption" size={-2} emphasis="critical">
                      {blockingReason}
                    </text.span>
                  </output>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>

      <div className="airo-input-secrets-paginated-form__footer">
        {stepTotal > 1 ? (
          <span className="airo-input-secrets-paginated-form__footer-nav">
            <Button
              design="inline"
              size="small"
              type="button"
              aria-label={backLabel}
              disabled={pending || stepIndex === 0}
              onClick={back}
              icon={<AsyncIcon icon="chevron-left" />}
            />
            <text.span
              as="caption"
              size={-2}
              emphasis="passive"
              className="airo-input-secrets-paginated-form__step-indicator"
              aria-live="polite"
            >
              {stepIndicatorLabel(stepIndex + 1, stepTotal)}
            </text.span>
            {!isLastStep ? (
              <Button
                design="inline"
                size="small"
                type="button"
                aria-label={forwardLabel}
                disabled={pending || cannotSubmit}
                onClick={forward}
                icon={<AsyncIcon icon="chevron-right" />}
              />
            ) : null}
          </span>
        ) : null}
        <span className="airo-input-secrets-paginated-form__footer-actions">
          {onClose && !showHeaderClose ? (
            <Button
              design="secondary"
              size="small"
              type="button"
              text={cancelLabel}
              disabled={isClosePending || submitInFlight}
              onClick={onClose}
            />
          ) : null}
          <Button
            design="primary"
            size="small"
            type="button"
            text={effectiveSubmitLabel}
            disabled={cannotSubmit}
            onClick={() => void commitStep()}
          />
        </span>
      </div>
    </div>
  );
}

export const SecretsPaginatedForm = Object.assign(SecretsPaginatedFormRoot, {
  Step: SecretsPaginatedFormStep,
});

export type { SecretsPaginatedFormStepProps } from './SecretsPaginatedFormStep';
