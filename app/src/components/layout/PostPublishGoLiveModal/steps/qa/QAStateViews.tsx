/**
 * QA State Views Component
 * Displays different states: analyzing, error, or success (clean)
 */
import Alert from '@ux/alert';
import AlertIcon from '@ux/icon/alert';
import OkIcon from '@ux/icon/ok';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { useTranslations } from '@/hooks/useTranslations';

interface QAStateViewsProps {
  isAnalyzing: boolean;
  analysisError: string | null;
  isClean: boolean;
  totalFixedCount: number;
}

export function QAStateViews({ isAnalyzing, analysisError, isClean, totalFixedCount }: QAStateViewsProps) {
  const t = useTranslations();

  // Analyzing State
  if (isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-4">
        <Spinner size="lg" />
        <TextLockup title={t('golive_qa_analyzing_title')} centered>
          <div className="text-intents-ux-feedbackHighContrastPassive-feedbackColor">{t('golive_qa_analyzing_description')}</div>
        </TextLockup>
      </div>
    );
  }

  // Error State
  if (analysisError) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-2">
        <AlertIcon className="text-intents-ux-feedbackHighContrastCritical-feedbackColor size-8" />
        <TextLockup title={t('golive_qa_error_title')} centered titleLevel={4} />
        <Alert emphasis="critical" className="w-full mt-2">
          {analysisError}
        </Alert>
      </div>
    );
  }

  // Clean State
  if (isClean) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-2">
        <OkIcon className="text-intents-ux-feedbackHighContrastSuccess-feedbackColor size-8" />
        <TextLockup title={t('golive_qa_clean_title')} centered titleLevel={4}>
          {totalFixedCount > 0
            ? t('golive_qa_clean_description_with_fixes', { count: totalFixedCount })
            : t('golive_qa_clean_description')}
        </TextLockup>
      </div>
    );
  }

  return null;
}
