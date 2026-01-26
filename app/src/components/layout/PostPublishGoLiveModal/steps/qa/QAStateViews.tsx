/**
 * QA State Views Component
 * Displays different states: analyzing, error, or success (clean)
 */
import { AlertCircle, CheckCircle } from 'lucide-react';
import Alert from '@ux/alert';
import Spinner from '@ux/spinner';
import text from '@ux/text';

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
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <Spinner size="lg" />
        <div className="text-center">
          <text.p as="paragraph" size={1} className="font-semibold mb-2">
            {t('golive_qa_analyzing_title')}
          </text.p>
          <text.p as="paragraph" size={0} emphasis="passive">
            {t('golive_qa_analyzing_description')}
          </text.p>
        </div>
      </div>
    );
  }

  // Error State
  if (analysisError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <AlertCircle style={{ width: '64px', height: '64px', color: '#ef4444' }} />
        <div className="text-center max-w-md">
          <text.p as="paragraph" size={1} className="font-semibold mb-2" style={{ color: '#dc2626' }}>
            {t('golive_qa_error_title')}
          </text.p>
          <Alert emphasis="critical">
            <div className="text-sm">
              {analysisError}
            </div>
          </Alert>
        </div>
      </div>
    );
  }

  // Clean State
  if (isClean) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="flex flex-col items-center text-center gap-4 max-w-md">
          <CheckCircle style={{ width: '64px', height: '64px', color: '#16a34a' }} />
          <div>
            <text.h4 size={2} className="font-bold mb-2" style={{ color: '#166534' }}>
              {t('golive_qa_clean_title')}
            </text.h4>
            <text.p size={0} style={{ color: '#15803d' }}>
              {totalFixedCount > 0
                ? t('golive_qa_clean_description_with_fixes', { count: totalFixedCount })
                : t('golive_qa_clean_description')}
            </text.p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
