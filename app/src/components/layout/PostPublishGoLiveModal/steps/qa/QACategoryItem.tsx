/**
 * QA Category Item Component
 * Displays a collapsible category with issues
 */
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-react';

import { useTranslations } from '@/hooks/useTranslations';
import type { QAIssue } from '@/types/qa';
import { QAIssueItem } from './QAIssueItem';

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
      <div className="flex items-center gap-3 px-4 py-3 bg-intents-ux-boxLowContrast-backgroundColor">
        {/* Chevron button */}
        <button
          onClick={onToggleCategory}
          className="hover:bg-intents-ux-boxMediumContrast-backgroundColor rounded p-1 transition-colors"
          aria-label={isExpanded ? t('golive_qa_category_collapse') : t('golive_qa_category_expand')}
        >
          {isExpanded ? (
            <ChevronDown style={{ width: '16px', height: '16px' }} className="text-intents-ux-textPassive-color" />
          ) : (
            <ChevronRight style={{ width: '16px', height: '16px' }} className="text-intents-ux-textPassive-color" />
          )}
        </button>

        {/* Select all checkbox */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCategorySelection();
          }}
          className="flex-shrink-0"
          aria-label={allCategorySelected ? t('golive_qa_category_deselect_all') : t('golive_qa_category_select_all')}
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            border: `2px solid ${allCategorySelected ? '#3b82f6' : '#d1d5db'}`,
            backgroundColor: allCategorySelected ? '#3b82f6' : '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative'
          }}
        >
          {allCategorySelected ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : someCategorySelected ? (
            <div style={{ width: '8px', height: '2px', backgroundColor: '#3b82f6' }} />
          ) : null}
        </button>

        <span className="flex-1 text-left font-semibold text-base">{categoryName}</span>
        <div className="flex gap-3 items-center">
          {errorCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#dc2626' }}>
              <AlertCircle style={{ width: '14px', height: '14px' }} /> {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#ca8a04' }}>
              <AlertTriangle style={{ width: '14px', height: '14px' }} /> {warningCount}
            </span>
          )}
          {suggestionCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#2563eb' }}>
              <Info style={{ width: '14px', height: '14px' }} /> {suggestionCount}
            </span>
          )}
        </div>
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
