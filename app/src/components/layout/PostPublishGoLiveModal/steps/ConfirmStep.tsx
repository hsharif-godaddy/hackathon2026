/**
 * Confirmation step for Go Live modal
 * Explains what will happen next and asks for confirmation
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
    <div className="space-y-4">
      <text.p as="paragraph" size={0}>
        {t('golive_confirm_intro')}
      </text.p>

      <div className="space-y-2">
        {/* QA */}
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 bg-intents-ux-feedbackSuccess-backgroundColor rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-intents-ux-feedbackHighContrastSuccess-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <text.p as="paragraph" size={0} className="font-semibold">{t('golive_confirm_qa_title')}</text.p>
            <text.p as="paragraph" size={-1} emphasis="passive">{t('golive_confirm_qa_description')}</text.p>
          </div>
        </div>

        {/* Security Scan */}
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 bg-intents-ux-feedbackInfo-backgroundColor rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-intents-ux-feedbackHighContrastInfo-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <text.p as="paragraph" size={0} className="font-semibold">{t('golive_confirm_security_title')}</text.p>
            <text.p as="paragraph" size={-1} emphasis="passive">{t('golive_confirm_security_description')}</text.p>
          </div>
        </div>

        {/* Video Generation */}
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 bg-intents-ux-feedbackWarning-backgroundColor rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-intents-ux-feedbackHighContrastWarning-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <text.p as="paragraph" size={0} className="font-semibold">{t('golive_confirm_video_title')}</text.p>
            <text.p as="paragraph" size={-1} emphasis="passive">{t('golive_confirm_video_description')}</text.p>
          </div>
        </div>

        {/* Marketing Content */}
        <div className="flex items-start gap-2">
          <div className="w-5 h-5 bg-intents-ux-feedbackSuccess-backgroundColor rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3 h-3 text-intents-ux-feedbackHighContrastSuccess-feedbackColor" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <text.p as="paragraph" size={0} className="font-semibold">{t('golive_confirm_marketing_title')}</text.p>
            <text.p as="paragraph" size={-1} emphasis="passive">{t('golive_confirm_marketing_description')}</text.p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button design="secondary" text={t('golive_confirm_button_cancel')} size="md" onClick={onCancel} />
        <Button design="primary" text={t('golive_confirm_button_confirm')} size="md" onClick={onConfirm} />
      </div>
    </div>
  );
}
