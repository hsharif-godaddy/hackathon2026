/**
 * QA Category Item Component
 * Displays a collapsible category with issues
 */
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { QAIssue } from '@/types/qa';
import { QAIssueItem } from './QAIssueItem';
import { QASeverityIcon } from './QASeverityIcon';

interface QACategoryItemProps {
  categoryName: string;
  issues: QAIssue[];
  isExpanded: boolean;
  selectedIssues: Set<string>;
  onToggleCategory: () => void;
  onToggleIssue: (issueId: string) => void;
  onToggleCategorySelection: () => void;
}

export function QACategoryItem({
  categoryName,
  issues,
  isExpanded,
  selectedIssues,
  onToggleCategory,
  onToggleIssue,
  onToggleCategorySelection
}: QACategoryItemProps) {
  const t = useTranslations();
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;
  const suggestionCount = issues.filter(i => i.severity === 'suggestion').length;

  const categoryIssueIds = issues.map(i => i.id);
  const allCategorySelected = categoryIssueIds.length > 0 && categoryIssueIds.every(id => selectedIssues.has(id));
  const someCategorySelected = categoryIssueIds.some(id => selectedIssues.has(id)) && !allCategorySelected;

  return (
    <div className="border border-intents-ux-boxLowContrast-borderColor rounded-lg overflow-hidden">
      {/* Category Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-intents-ux-boxLowContrast-backgroundColor">
        <Checkbox
          id={`qa-category-${categoryName}`}
          name={`qa-category-${categoryName}`}
          checked={allCategorySelected || someCategorySelected}
          indeterminate={someCategorySelected}
          onChange={() => onToggleCategorySelection()}
          aria-label={allCategorySelected ? t('golive_qa_category_deselect_all') : t('golive_qa_category_select_all')}
        />

        <div className="flex flex-grow sm:flex-wrap gap-x-2 gap-y-0.5 max-sm:flex-col">
          <text.span as="title" className="flex-1 text-left">{categoryName}</text.span>
          <div className="flex gap-2 items-center">
            {errorCount > 0 && (
              <text.span as="caption" emphasis="critical" className="flex items-center gap-0.5">
                <QASeverityIcon severity="error" size={14} /> {errorCount}
              </text.span>
            )}
            {warningCount > 0 && (
              <text.span as="caption" emphasis="warning" className="flex items-center gap-0.5">
                <QASeverityIcon severity="warning" size={14} /> {warningCount}
              </text.span>
            )}
            {suggestionCount > 0 && (
              <text.span as="caption" emphasis="info" className="flex items-center gap-0.5">
                <QASeverityIcon severity="suggestion" size={14} /> {suggestionCount}
              </text.span>
            )}
          </div>
        </div>

        {/* Chevron button */}
        <Button
          design="minimal"
          size="sm"
          onClick={onToggleCategory}
          icon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
          aria-label={isExpanded ? t('golive_qa_category_collapse') : t('golive_qa_category_expand')}
        />
      </div>

      {/* Issues */}
      {isExpanded && (
        <div className="border-t border-intents-ux-boxLowContrast-borderColor">
          {issues.map((issue, idx) => (
            <QAIssueItem
              key={issue.id}
              issue={issue}
              isSelected={selectedIssues.has(issue.id)}
              isLastItem={idx === issues.length - 1}
              onToggle={onToggleIssue}
            />
          ))}
        </div>
      )}
    </div>
  );
}
