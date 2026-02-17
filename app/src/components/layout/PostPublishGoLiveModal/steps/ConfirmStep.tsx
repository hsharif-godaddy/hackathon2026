/**
 * Initial confirmation step for Go Live modal
 * Confirms whether user wants to proceed with launch preparation
 * (site is already published, this is about post-publish optimization)
 */

import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';

import { ButtonBar } from '@/components/layout/PostPublishGoLiveModal/components/ButtonBar';
import { useTranslations } from '@/hooks/useTranslations';

interface ConfirmStepProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmStep({ onConfirm, onCancel }: ConfirmStepProps) {
  const t = useTranslations();

  return (
    <Box inlineAlignChildren="center" gap="xl">
      <TextLockup
        title={
          <>
            {t('builder_golive_modal_title_confirm')}
            <br />
            {t('builder_golive_confirm_title')}
          </>
        }
        size="xl"
        centered
      >
        {t('builder_golive_confirm_description')}
      </TextLockup>

      <ButtonBar>
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
      </ButtonBar>
    </Box>
  );
}
