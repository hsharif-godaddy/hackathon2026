'use client';

import Alert from '@ux/alert';
import Button from '@ux/button';

import { useTranslations } from '@/hooks/useTranslations';

export interface PromptErrorAlertProps {
  error: string | null;
  onDismiss: () => void;
}

export function PromptErrorAlert({ error, onDismiss }: PromptErrorAlertProps) {
  const t = useTranslations();

  if (!error) {
    return null;
  }

  return (
    <div className="w-full max-w-2xl mx-auto mt-2 md:mt-4">
      <Alert
        emphasis="critical"
        title={t('builder_status_error')}
        actions={<Button text={t('builder_common_dismiss')} onClick={onDismiss} />}
      >
        {error}
      </Alert>
    </div>
  );
}
