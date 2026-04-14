/**
 * QA Issue Item Component
 * Displays a single issue with checkbox, severity, and details
 */
import Checkbox from '@ux/checkbox';
import Tag from '@ux/tag';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { useTranslations } from '@/hooks/useTranslations';
import type { QAIssue } from '@/types/qa';
import { QASeverityIcon } from './QASeverityIcon';

interface QAIssueItemProps {
  issue: QAIssue;
  isSelected: boolean;
  onToggle: (issueId: string) => void;
}

export function QAIssueItem({ issue, isSelected, onToggle }: QAIssueItemProps) {
  const t = useTranslations();
  return (
    <div
      className="px-3 py-2.5 cursor-pointer border-b last:border-b-0 border-intents-ux-box-borderColor"
      onClick={() => onToggle(issue.id)}
    >
      <div className="flex items-start gap-2">
        {/* stopPropagation prevents double-toggle from the row's onClick */}
        <div onClick={(e) => e.stopPropagation()} className="mt-0.5">
          <Checkbox
            id={`qa-issue-${issue.id}`}
            name={`qa-issue-${issue.id}`}
            checked={isSelected}
            onChange={() => onToggle(issue.id)}
          />
        </div>

        {/* Issue Content */}
        <div className="flex flex-col gap-1">
          <TextLockup
            size="sm"
            title={
              <span className="flex items-center gap-1 flex-wrap">
                <QASeverityIcon severity={issue.severity} size={12} />
                {issue.title}
                {!issue.autoFixable && (
                  <Tag emphasis="warning" size="sm">
                    {t('golive_qa_issue_manual_badge')}
                  </Tag>
                )}
              </span>
            }
          >
            <p>{issue.description}</p>
          </TextLockup>
          {issue.recommendation && (
            <text.div
              size={-1}
              className="bg-intents-ux-feedbackInfo-feedbackColor text-intents-ux-feedbackInfo-onFeedbackColor p-2"
            >
              <strong>{issue.autoFixable ? t('golive_qa_issue_fix_label') : t('golive_qa_issue_note_label')}</strong> {issue.recommendation}
            </text.div>
          )}
          {issue.location?.file && (
            <text.p size={-2} emphasis="passive">{issue.location.file}{issue.location.line ? `:${issue.location.line}` : ''}</text.p>
          )}
        </div>
      </div>
    </div>
  );
}
