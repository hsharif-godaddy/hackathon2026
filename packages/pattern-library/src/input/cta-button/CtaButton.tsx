import Box from '@ux/box';
import Button from '@ux/button';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import classnames from 'classnames';
import { type HTMLAttributes, type ReactNode, useState } from 'react';

/**
 * Status of the CTA action flow.
 */
export type CtaButtonStatus = 'pending' | 'processing' | 'success' | 'error';

/**
 * Props for {@link CtaButton}.
 *
 * @see ./README.md
 */
export interface CtaButtonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /**
   * Icon to display in the header (e.g., `<AsyncIcon icon="user-locked" />`).
   * Should be a valid React node, typically a UXCore icon component.
   */
  icon: ReactNode;
  /**
   * Title line above the description (e.g., **"Authentication Required"**).
   * Rendered as an **`h3`** with caption-scale typography.
   * @default "Action Required"
   */
  title?: string;
  /**
   * Description text explaining what action is needed.
   * Shown below the title in the header area.
   */
  description: string;
  /**
   * Additional helper text shown below the description.
   * Use for supplementary information like "A popup window will open..."
   */
  helperText?: string;
  /**
   * Label for the primary action button.
   * @default "Continue"
   */
  actionLabel?: string;
  /**
   * Accessible label for the header close button.
   * @default "Close"
   */
  closeLabel?: string;
  /**
   * Called when the user clicks the primary action button.
   * Can be sync or async. While processing, the button shows a disabled state.
   */
  onAction?: () => void | Promise<void>;
  /**
   * Called when the user clicks the close (X) button.
   * Required so the user can dismiss the widget without taking action.
   */
  onClose: () => void;
  /**
   * Current status of the action. Controls the UI state and available interactions.
   * - `pending`: Initial state, action button is enabled
   * - `processing`: Action is in progress, button is disabled
   * - `success`: Action completed successfully, shows success message
   * - `error`: Action failed, shows error message with retry option
   * @default "pending"
   */
  status?: CtaButtonStatus;
  /**
   * Message to display when `status="processing"`.
   * @default "Processing..."
   */
  processingMessage?: string;
  /**
   * Success message to display when `status="success"`.
   * @default "Action completed successfully"
   */
  successMessage?: string;
  /**
   * Label text shown in error state header (before the error message).
   * @default "Action failed"
   */
  errorLabel?: string;
  /**
   * Error message to display when `status="error"`.
   * Only shown when status is "error".
   */
  errorMessage?: string;
  /**
   * Label for the retry button shown in error state.
   * @default "Try Again"
   */
  retryLabel?: string;
  /**
   * Label for the cancel button shown in error state.
   * @default "Cancel"
   */
  cancelLabel?: string;
  /**
   * When `true`, strips the widget's outer card chrome (background, border,
   * radius, elevation, and overflow clip). The internal layout stays intact.
   *
   * Use this when nesting the widget inside a host that already provides a
   * surface, e.g. a `PromptBox` expansion area or a `PromptStage` swap slot.
   *
   * @default false
   */
  borderless?: boolean;
}

/**
 * CTA button widget for the chat input area. Replaces the composer with a
 * focused call-to-action (e.g., authentication prompt, external action).
 *
 * Displays an icon, title, description, and primary action button. Supports
 * multiple states: pending, processing, success, and error with retry.
 *
 * @example
 * ```tsx
 * import { CtaButton } from '@airo-ux/pattern-library/input/cta-button';
 * import AsyncIcon from '@ux/icon/async-icon.js';
 * import '@airo-ux/pattern-library/input/cta-button/styles';
 *
 * <CtaButton
 *   icon={<AsyncIcon icon="user-locked" />}
 *   title="Authentication Required"
 *   description="This action requires GoDaddy OAuth permission for:"
 *   helperText="A popup window will open for secure authentication with GoDaddy"
 *   actionLabel="Authenticate with GoDaddy"
 *   onAction={async () => {
 *     await openAuthPopup();
 *   }}
 *   onClose={() => {
 *     dismissAuthPrompt();
 *   }}
 *   status="pending"
 * />
 * ```
 *
 * @see ./README.md
 */
export function CtaButton({
  icon,
  title = 'Action Required',
  description,
  helperText,
  actionLabel = 'Continue',
  closeLabel = 'Close',
  onAction,
  onClose,
  status = 'pending',
  processingMessage = 'Processing...',
  successMessage = 'Action completed successfully',
  errorLabel = 'Action failed',
  errorMessage,
  retryLabel = 'Try Again',
  cancelLabel = 'Cancel',
  borderless = false,
  className,
  ...rest
}: CtaButtonProps) {
  const [internalProcessing, setInternalProcessing] = useState(false);
  const isProcessing = status === 'processing' || internalProcessing;

  const handleAction = async () => {
    if (isProcessing || !onAction) return;

    setInternalProcessing(true);
    try {
      await Promise.resolve(onAction());
    } finally {
      setInternalProcessing(false);
    }
  };

  return (
    <Box
      displayType="flex"
      orientation="vertical"
      elevation={borderless ? 'base' : 'raised'}
      className={classnames(
        'airo-input-cta-button',
        borderless && 'airo-input-cta-button--borderless',
        className,
      )}
      {...rest}
    >
      {/* Header with icon, title, description, and close button */}
      <div className="airo-input-cta-button__header">
        <div className="airo-input-cta-button__header-content">
          <div className="airo-input-cta-button__icon-title-row">
            <span className="airo-input-cta-button__icon" aria-hidden="true">
              {icon}
            </span>
            <text.h3 as="caption" size={-1} className="airo-input-cta-button__title">
              {title}
            </text.h3>
          </div>
          <text.p as="caption" size={-1} className="airo-input-cta-button__description">
            {description}
          </text.p>
        </div>
        {status === 'pending' && (
          <Button
            design="inline"
            size="small"
            className="airo-input-cta-button__chrome-button"
            icon={<AsyncIcon icon="x" />}
            aria-label={closeLabel}
            onClick={onClose}
          />
        )}
      </div>

      {/* Action area: changes based on status */}
      <div className="airo-input-cta-button__action-area">
        {status === 'pending' && (
          <>
            {helperText && (
              <text.p
                as="caption"
                size={-2}
                emphasis="passive"
                className="airo-input-cta-button__helper-text"
              >
                {helperText}
              </text.p>
            )}
            <Button
              design="primary"
              size="small"
              onClick={handleAction}
              disabled={isProcessing}
              className="airo-input-cta-button__action-button"
              text={actionLabel}
            />
          </>
        )}

        {status === 'processing' && (
          <div
            className="airo-input-cta-button__status-message"
            // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically correct for non-form status messages
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <text.span as="caption" size={-1} emphasis="passive">
              {processingMessage}
            </text.span>
          </div>
        )}

        {status === 'success' && (
          <div
            className="airo-input-cta-button__status-message airo-input-cta-button__status-message--success"
            // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically correct for non-form status messages
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="airo-input-cta-button__status-icon" aria-hidden="true">
              <AsyncIcon icon="checkmark" />
            </span>
            <text.span as="caption" size={-1}>
              {successMessage}
            </text.span>
          </div>
        )}

        {status === 'error' && (
          <div className="airo-input-cta-button__error-state">
            <div
              className="airo-input-cta-button__status-message airo-input-cta-button__status-message--error"
              // biome-ignore lint/a11y/useSemanticElements: role="status" is semantically correct for non-form status messages
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span className="airo-input-cta-button__status-icon" aria-hidden="true">
                <AsyncIcon icon="x" />
              </span>
              <text.span as="caption" size={-1}>
                {errorLabel}
              </text.span>
            </div>
            {errorMessage && (
              <text.p
                as="caption"
                size={-2}
                emphasis="passive"
                className="airo-input-cta-button__error-message"
              >
                {errorMessage}
              </text.p>
            )}
            <div className="airo-input-cta-button__error-actions">
              <Button
                design="secondary"
                size="small"
                onClick={handleAction}
                disabled={isProcessing || !onAction}
                className="airo-input-cta-button__chrome-button"
                text={retryLabel}
              />
              <Button
                design="tertiary"
                size="small"
                onClick={onClose}
                disabled={isProcessing}
                className="airo-input-cta-button__chrome-button"
                text={cancelLabel}
              />
            </div>
          </div>
        )}
      </div>
    </Box>
  );
}
