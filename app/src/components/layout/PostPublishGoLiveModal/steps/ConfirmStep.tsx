/**
 * Initial confirmation step for Go Live modal
 * Confirms whether user wants to proceed with launch preparation
 * (site is already published, this is about post-publish optimization)
 */

import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

interface ConfirmStepProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmStep({ onConfirm, onCancel }: ConfirmStepProps) {
  const t = useTranslations();

  return (
    <div className="space-y-6">
      <text.h2 as="heading" size={1} className="text-center font-semibold">
        {t('builder_golive_confirm_title')}
      </text.h2>

      <text.p as="paragraph" size={0} className="text-center">
        {t('builder_golive_confirm_description')}
      </text.p>

      <div className="flex justify-center gap-3 pt-4">
        <Button
          design="secondary"
          text={t('builder_golive_confirm_button_later')}
          size="md"
          onClick={onCancel}
          data-testid="go-live-modal-later"
        />
        <Button
          design="primary"
          text={t('builder_golive_confirm_button_continue')}
          size="md"
          onClick={onConfirm}
          data-testid="go-live-modal-continue"
        />
      </div>
    </div>
  );
}
