/**
 * QA Summary Banner Component
 * Displays a summary of unfixed issues with severity-based styling
 */
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';

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

export function QASummaryBanner({ totalUnfixedIssues, totalFixedCount, unfixedCounts }: QASummaryBannerProps) {
  const t = useTranslations();
  const hasErrors = unfixedCounts.errors > 0;
  const hasWarnings = unfixedCounts.warnings > 0;

  const Icon = hasErrors ? AlertCircle : hasWarnings ? AlertTriangle : Info;
  const iconColor = hasErrors ? '#dc2626' : hasWarnings ? '#ca8a04' : '#2563eb';
  const bgColor = hasErrors ? '#fef2f2' : hasWarnings ? '#fefce8' : '#eff6ff';
  const borderColor = hasErrors ? '#fecaca' : hasWarnings ? '#fef08a' : '#bfdbfe';
  const textColor = hasErrors ? '#991b1b' : hasWarnings ? '#854d0e' : '#1e40af';
  const subtextColor = hasErrors ? '#b91c1c' : hasWarnings ? '#a16207' : '#1d4ed8';

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

  return (
    <div
      className="flex items-center gap-4 p-4 rounded-lg border"
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
      }}
    >
      <Icon style={{ width: '28px', height: '28px', color: iconColor, flexShrink: 0 }} />
      <div className="flex-1">
        <div className="font-semibold text-base mb-1" style={{ color: textColor }}>
          {totalUnfixedIssues === 1
            ? t('golive_qa_issues_found_singular')
            : t('golive_qa_issues_found_plural', { count: totalUnfixedIssues })}
          {totalFixedCount > 0 && ` (${t('golive_qa_fixed_count', { count: totalFixedCount })})`}
        </div>
        <div className="text-sm" style={{ color: subtextColor }}>
          {countParts.join(', ')}
        </div>
      </div>
    </div>
  );
}
