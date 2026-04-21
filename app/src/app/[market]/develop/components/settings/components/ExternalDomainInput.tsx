'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import TextInput from '@ux/text-input';

import { useTranslations } from '@/hooks/useTranslations';

export interface ExternalDomainInputProps {
  /** Current domain input value */
  value: string | null;
  /** Callback when input value changes (UXCore TextInput passes value directly) */
  onChange: (value: string) => void;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Whether validation is in progress */
  isValidating?: boolean;
  /** Whether validation has completed for current value */
  isValidationComplete?: boolean;
  /** Whether the domain is available (validation passed) */
  isAvailable?: boolean;
  /** Callback when add button is clicked */
  onAdd: () => void;
  /** Optional data-eid for analytics */
  dataEid?: string;
  /** Additional class name for the container */
  className?: string;
  /** Additional class name for the button */
  buttonClassName?: string;
}

/**
 * Shared external domain input component with validation and add button.
 * Used by both DomainAttachWidget (chat) and DomainAttach (settings panel).
 */
export default function ExternalDomainInput({
  value,
  onChange,
  disabled = false,
  errorMessage,
  isValidating = false,
  isValidationComplete = true,
  isAvailable = false,
  onAdd,
  dataEid,
  className,
  buttonClassName,
}: ExternalDomainInputProps) {
  const t = useTranslations();

  const isButtonDisabled =
    disabled ||
    !value ||
    value.length === 0 ||
    isValidating ||
    !isValidationComplete ||
    !isAvailable;

  return (
    <Box orientation="vertical" gap="sm" className={className}>
      <TextInput
        className="w-full"
        id="external-domain-input"
        label={null}
        onChange={onChange}
        helpMessage={t('builder_custom_domain_input_help')}
        value={value ?? ''}
        visualSize="sm"
        disabled={disabled}
        errorMessage={errorMessage}
      />

      {value && (
        <Button
          text={
            isValidating || !isValidationComplete
              ? t('builder_custom_domain_button_checking')
              : t('builder_custom_domain_button_add')
          }
          design="primary"
          size="sm"
          onClick={onAdd}
          disabled={isButtonDisabled}
          {...(dataEid ? { 'data-eid': dataEid } : {})}
          {...(buttonClassName ? { className: buttonClassName } : {})}
        />
      )}
    </Box>
  );
}
