/**
 * QA Analysis Types
 *
 * Shared types for QA analysis results used in Go Live modal and related components.
 */

export interface QAIssue {
  id: string;
  category: string;
  severity: 'error' | 'warning' | 'suggestion';
  title: string;
  description: string;
  location?: {
    file?: string;
    line?: number;
    page?: string;
  };
  recommendation: string;
  autoFixable: boolean;
  suggestedFix?: string;
  fixed?: boolean;
}

export interface QACategorySummary {
  name: string;
  engine: string;
  status: 'pass' | 'warning' | 'error';
  issueCount: number;
  issues: QAIssue[];
}

export interface QASummary {
  total: number;
  errors: number;
  warnings: number;
  suggestions: number;
  passed: number;
}

export interface QAReport {
  summary: QASummary;
  categories: QACategorySummary[];
}

export interface FixedIssue {
  id: string;
  title: string;
  category: string;
  severity: 'error' | 'warning' | 'suggestion';
  fixedAt: number | null;
}

export interface FixedIssuesData {
  total: number;
  newlyFixed: number;
  recentlyFixed: FixedIssue[];
}
