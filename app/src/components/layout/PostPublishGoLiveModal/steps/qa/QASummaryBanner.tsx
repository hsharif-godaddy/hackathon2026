/**
 * QA Summary Banner Component
 * Displays a summary of unfixed issues using UXCore Alert with severity-based emphasis
 */
import Alert from '@ux/alert';

import { useTranslations } from '@/hooks/useTranslations';

interface QASummaryBannerProps {
  totalUnfixedIssues: number;
  totalFixedCount: number;
  unfixedCounts: {
    errors: number;
    warnings: number;
    suggestions: number;
  };
}

function getEmphasis(unfixedCounts: QASummaryBannerProps['unfixedCounts']): 'critical' | 'warning' | 'info' {
  if (unfixedCounts.errors > 0) {return 'critical';}
  if (unfixedCounts.warnings > 0) {return 'warning';}
  return 'info';
}

export function QASummaryBanner({ totalUnfixedIssues, totalFixedCount, unfixedCounts }: QASummaryBannerProps) {
  const t = useTranslations();

  const countParts = [];
  if (unfixedCounts.errors > 0) {
    countParts.push(
      unfixedCounts.errors === 1
        ? t('golive_qa_severity_errors_singular')
        : t('golive_qa_severity_errors_plural', { count: unfixedCounts.errors })
    );
  }
  if (unfixedCounts.warnings > 0) {
    countParts.push(
      unfixedCounts.warnings === 1
        ? t('golive_qa_severity_warnings_singular')
        : t('golive_qa_severity_warnings_plural', { count: unfixedCounts.warnings })
    );
  }
  if (unfixedCounts.suggestions > 0) {
    countParts.push(
      unfixedCounts.suggestions === 1
        ? t('golive_qa_severity_suggestions_singular')
        : t('golive_qa_severity_suggestions_plural', { count: unfixedCounts.suggestions })
    );
  }

  const title = totalUnfixedIssues === 1
    ? t('golive_qa_issues_found_singular')
    : t('golive_qa_issues_found_plural', { count: totalUnfixedIssues });

  const titleWithFixed = totalFixedCount > 0
    ? `${title} (${t('golive_qa_fixed_count', { count: totalFixedCount })})`
    : title;

  return (
    <Alert emphasis={getEmphasis(unfixedCounts)} title={titleWithFixed}>
      {countParts.join(', ')}
    </Alert>
  );
}
