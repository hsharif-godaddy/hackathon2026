/**
 * QA Issue Item Component
 * Displays a single issue with checkbox, severity, and details
 */
import { useTranslations } from '@/hooks/useTranslations';
import type { QAIssue } from '@/types/qa';
import { QASeverityIcon } from './QASeverityIcon';

interface QAIssueItemProps {
  issue: QAIssue;
  isSelected: boolean;
  isLastItem: boolean;
  onToggle: (issueId: string) => void;
}

export function QAIssueItem({ issue, isSelected, isLastItem, onToggle }: QAIssueItemProps) {
  const t = useTranslations();
  return (
    <div
      className="px-4 py-2.5 cursor-pointer hover:bg-intents-ux-boxLowContrast-backgroundColor transition-colors"
      style={{
        borderBottom: !isLastItem ? '1px solid var(--intents-ux-boxLowContrast-borderColor)' : 'none',
        backgroundColor: isSelected ? '#eff6ff' : 'transparent'
      }}
      onClick={() => onToggle(issue.id)}
    >
      <div className="flex items-start gap-2">
        {/* Checkbox */}
        <div
          className="flex-shrink-0 mt-0.5"
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '3px',
            border: `2px solid ${isSelected ? '#3b82f6' : '#d1d5db'}`,
            backgroundColor: isSelected ? '#3b82f6' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isSelected && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Issue Content */}
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <QASeverityIcon severity={issue.severity} size={12} />
            <span className="font-medium text-xs leading-tight">{issue.title}</span>
            {!issue.autoFixable && (
              <span className="text-xs px-1.5 py-0.5 rounded leading-none" style={{
                backgroundColor: '#fef3c7',
                color: '#92400e',
                fontSize: '10px'
              }}>
                {t('golive_qa_issue_manual_badge')}
              </span>
            )}
          </div>
          <div className="text-xs text-intents-ux-textPassive-color leading-snug">
            {issue.description}
          </div>
          {issue.recommendation && (
            <div
              className="text-xs px-2 py-1 rounded leading-snug"
              style={{
                color: issue.autoFixable ? '#059669' : '#b45309',
                backgroundColor: issue.autoFixable ? '#f0fdf4' : '#fffbeb',
                fontSize: '11px'
              }}
            >
              <span className="font-medium">{issue.autoFixable ? `💡 ${t('golive_qa_issue_fix_label')}` : `❓ ${t('golive_qa_issue_note_label')}`}</span> {issue.recommendation}
            </div>
          )}
          {issue.location?.file && (
            <div className="text-xs text-intents-ux-textPassive-color" style={{ fontSize: '10px' }}>
              📁 {issue.location.file}{issue.location.line ? `:${issue.location.line}` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
