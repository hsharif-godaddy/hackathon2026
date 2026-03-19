/**
 * QA Step
 *
 * Quality assurance screen that shows QA analysis results with detailed issue breakdown
 * Users can select issues to fix and send them to the AI agent
 */
'use client';

import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { ButtonBar } from '@/components/layout/PostPublishGoLiveModal/components/ButtonBar';
import { useWebSocketContext } from '@/contexts/WebSocketContext';
import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import type { QAIssue } from '@/types/qa';
import { QACategoryList } from './qa/QACategoryList';
import { QAStateViews } from './qa/QAStateViews';
import type { QAAnalysisResult } from '../hooks/useQAAnalysis';

interface QAStepProps {
  appId: string;
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: QAAnalysisResult | null;
  updateFixedIssues: (issueIds: string[]) => void;
  onContinue: () => void;
  onSkip: () => void;
  onClose: () => void;
}

export function QAStep({ appId, isAnalyzing, analysisError, analysisResults, updateFixedIssues, onContinue, onSkip, onClose }: QAStepProps) {
  const t = useTranslations();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [isMarkingFixed, setIsMarkingFixed] = useState(false);
  const { sendMessage } = useWebSocketContext();
  const { isMdBreakpoint } = useBreakpoints();

  const hasErrors = (analysisResults?.report?.summary?.errors || 0) > 0;
  const hasWarnings = (analysisResults?.report?.summary?.warnings || 0) > 0;
  const originalIsClean = analysisResults && !hasErrors && !hasWarnings &&
    (analysisResults.report?.summary?.suggestions || 0) === 0;

  const toggleCategory = (name: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleIssue = (id: string) => {
    setSelectedIssues(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleCategorySelection = (categoryIssues: QAIssue[]) => {
    const categoryIssueIds = categoryIssues.map(i => i.id);
    const allSelected = categoryIssueIds.every(id => selectedIssues.has(id));

    setSelectedIssues(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all
        categoryIssueIds.forEach(id => next.delete(id));
      } else {
        // Select all
        categoryIssueIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const handleFixSelected = async () => {
    if (selectedIssues.size === 0) {return;}

    setIsMarkingFixed(true);
    try {
      // Get full issue details for selected issues
      const allIssues = analysisResults?.report?.categories?.flatMap(c => c.issues) || [];
      const issuesToFix = allIssues.filter(issue => selectedIssues.has(issue.id));

      // Mark them as fixed locally
      updateFixedIssues(issuesToFix.map(i => i.id));

      // Count by severity
      const severityCounts = {
        errors: issuesToFix.filter(i => i.severity === 'error').length,
        warnings: issuesToFix.filter(i => i.severity === 'warning').length,
        suggestions: issuesToFix.filter(i => i.severity === 'suggestion').length
      };

      // Clean user-facing message
      const issueCountText = issuesToFix.length === 1
        ? t('golive_qa_issue_count_singular')
        : t('golive_qa_issue_count_plural', { count: issuesToFix.length });
      const message = t('golive_qa_fix_prompt', { issueCountText });

      logger.info('go-live.qa.send-fixes-to-ai', {
        appId,
        issueCount: issuesToFix.length
      });

      shipAnalyticsLog('go_live.qa.send_fixes_to_ai', {
        appId,
        issueCount: issuesToFix.length,
        severityCounts
      });

      // Send message with detailed issues in context (hidden from user)
      await sendMessage(
        message,
        undefined, // aiEditContext
        undefined, // selectedAsset
        undefined, // todoListContext
        undefined, // isActionRequest
        {
          type: 'qa_issues_fix_request',
          data: {
            runId: analysisResults?.runId,
            issueCount: issuesToFix.length,
            severityCounts,
            issues: issuesToFix.map(issue => ({
              id: issue.id,
              category: issue.category,
              severity: issue.severity,
              title: issue.title,
              description: issue.description,
              recommendation: issue.recommendation,
              autoFixable: issue.autoFixable,
              suggestedFix: issue.suggestedFix,
              location: issue.location
            })),
            instructions: 'Fix these issues one by one. For each issue, make the necessary code changes and explain what you did. After fixing all issues, remind the user to publish their site again to deploy the fixes.'
          },
          persistence: 'ephemeral',
          source: 'qa-modal'
        }
      );

      // Clear selection and close modal
      setSelectedIssues(new Set());
      onClose();
    } finally {
      setIsMarkingFixed(false);
    }
  };

  // Filter out fixed issues from all categories
  const fixedIssueIds = analysisResults?.fixedIssueIds || [];
  const categoriesWithIssues = analysisResults?.report?.categories
    ?.map(category => ({
      ...category,
      issues: category.issues.filter(issue => !fixedIssueIds.includes(issue.id))
    }))
    .filter(c => c.issues.length > 0) || [];

  // Recalculate summary without fixed issues
  const totalUnfixedIssues = categoriesWithIssues.reduce((sum, cat) => sum + cat.issues.length, 0);
  const unfixedCounts = categoriesWithIssues.reduce((acc, cat) => {
    const errors = cat.issues.filter(i => i.severity === 'error').length;
    const warnings = cat.issues.filter(i => i.severity === 'warning').length;
    const suggestions = cat.issues.filter(i => i.severity === 'suggestion').length;
    return {
      errors: acc.errors + errors,
      warnings: acc.warnings + warnings,
      suggestions: acc.suggestions + suggestions
    };
  }, { errors: 0, warnings: 0, suggestions: 0 });

  // Check if all remaining issues have been addressed
  const isClean = originalIsClean || totalUnfixedIssues === 0;

  const totalFixedCount = fixedIssueIds.length;
  const showResults = !isAnalyzing && !analysisError && analysisResults;
  const showSelectedIssueCount = !isAnalyzing && selectedIssues.size > 0;

  return (
    <Box gap="xl">
      <div className="max-h-[400px] overflow-y-auto">
        <QAStateViews
          isAnalyzing={isAnalyzing}
          analysisError={analysisError}
          isClean={!!(isClean && showResults)}
          totalFixedCount={totalFixedCount}
        />

        {/* Results - Issues Found */}
        {showResults && !isClean && (
          <QACategoryList
            categories={categoriesWithIssues}
            totalUnfixedIssues={totalUnfixedIssues}
            totalFixedCount={totalFixedCount}
            unfixedCounts={unfixedCounts}
            expandedCategories={expandedCategories}
            selectedIssues={selectedIssues}
            onToggleCategory={toggleCategory}
            onToggleIssue={toggleIssue}
            onToggleCategorySelection={toggleCategorySelection}
          />
        )}
      </div>

      {/* Footer with selection info */}
      <Box
        orientation="horizontal"
        blockAlignChildren={(showSelectedIssueCount && isMdBreakpoint) ? "spaceBetween" : "end"}
        inlineAlignChildren="center"
        gap="md"
        wrap
      >
        {showSelectedIssueCount ? (
          <text.span as="caption" emphasis="passive">
            {selectedIssues.size === 1
              ? t('golive_qa_selected_count_singular')
              : t('golive_qa_selected_count_plural', { count: selectedIssues.size })}
          </text.span>
        ) : null}
        <ButtonBar>
          <Button
            design="secondary"
            text={t('golive_qa_button_skip')}
            onClick={onSkip}
            disabled={isAnalyzing}
          />
          {!isClean ? (
            <Button
              design="primary"
              text={isMarkingFixed
                ? t('golive_qa_button_fixing')
                : selectedIssues.size > 0
                  ? t('golive_qa_button_fix_selected', { count: selectedIssues.size })
                  : t('golive_qa_button_fix')}
              onClick={handleFixSelected}
              disabled={isAnalyzing || isMarkingFixed || selectedIssues.size === 0}
            />
          ) : (
            <Button
              design="primary"
              text={t('golive_qa_button_continue')}
              onClick={onContinue}
              disabled={isAnalyzing}
            />
          )}
        </ButtonBar>
      </Box>
    </Box>
  );
}
