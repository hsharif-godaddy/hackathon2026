/**
 * QA State Views Component
 * Displays different states: analyzing, error, or success (clean)
 */
import Alert from '@ux/alert';

import { Loader } from '@/components/layout/PostPublishGoLiveModal/components/Loader';
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
      <Loader
        title={t('golive_qa_analyzing_title')}
        description={t('golive_qa_analyzing_description')}
      />
    );
  }

  // Error State
  if (analysisError) {
    return (
      <Alert
        emphasis="critical"
        title={t('golive_qa_error_title')}
      >
        {analysisError}
      </Alert>
    );
  }

  // Clean State
  if (isClean) {
    return (
      <Alert
        emphasis="success"
        title={t('golive_qa_clean_title')}
      >
        {totalFixedCount > 0
          ? t('golive_qa_clean_description_with_fixes', { count: totalFixedCount })
          : t('golive_qa_clean_description')
        }
      </Alert>
    );
  }

  return null;
}
