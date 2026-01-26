/**
 * QA Category List Component
 * Displays the list of issue categories with summary
 */
import type { QAIssue } from '@/types/qa';
import { QACategoryItem } from './QACategoryItem';
import { QASummaryBanner } from './QASummaryBanner';

interface CategoryWithIssues {
  name: string;
  issues: QAIssue[];
}

interface QACategoryListProps {
  categories: CategoryWithIssues[];
  totalUnfixedIssues: number;
  totalFixedCount: number;
  unfixedCounts: {
    errors: number;
    warnings: number;
    suggestions: number;
  };
  expandedCategories: Set<string>;
  selectedIssues: Set<string>;
  onToggleCategory: (name: string) => void;
  onToggleIssue: (id: string) => void;
  onToggleCategorySelection: (issues: QAIssue[]) => void;
}

export function QACategoryList({
  categories,
  totalUnfixedIssues,
  totalFixedCount,
  unfixedCounts,
  expandedCategories,
  selectedIssues,
  onToggleCategory,
  onToggleIssue,
  onToggleCategorySelection
}: QACategoryListProps) {
  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <QASummaryBanner
        totalUnfixedIssues={totalUnfixedIssues}
        totalFixedCount={totalFixedCount}
        unfixedCounts={unfixedCounts}
      />

      {/* Category List */}
      <div className="space-y-2">
        {categories.map((category) => (
          <QACategoryItem
            key={category.name}
            categoryName={category.name}
            issues={category.issues}
            isExpanded={expandedCategories.has(category.name)}
            selectedIssues={selectedIssues}
            onToggleCategory={() => onToggleCategory(category.name)}
            onToggleIssue={onToggleIssue}
            onToggleCategorySelection={() => onToggleCategorySelection(category.issues)}
          />
        ))}
      </div>
    </div>
  );
}
