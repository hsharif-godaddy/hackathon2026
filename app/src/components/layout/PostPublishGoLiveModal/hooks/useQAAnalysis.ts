/**
 * Hook for managing QA analysis logic
 * Uses useReducer for clearer state transitions
 */

import { useCallback, useReducer } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import type { QAReport } from '@/types/qa';

export interface QAAnalysisResult {
  success: boolean;
  report: QAReport;
  timestamp: string;
  runId: string;
  isCached?: boolean;
  fixedIssueIds?: string[];
}

// State type
interface QAAnalysisState {
  isAnalyzing: boolean;
  analysisError: string | null;
  analysisResults: QAAnalysisResult | null;
}

// Action types
type QAAnalysisAction =
  | { type: 'ANALYSIS_START' }
  | { type: 'ANALYSIS_SUCCESS'; payload: QAAnalysisResult }
  | { type: 'ANALYSIS_ERROR'; payload: string }
  | { type: 'ANALYSIS_SKIP'; payload: QAAnalysisResult }
  | { type: 'UPDATE_FIXED_ISSUES'; payload: string[] };

// Initial state
const initialState: QAAnalysisState = {
  isAnalyzing: false,
  analysisError: null,
  analysisResults: null
};

// Reducer function with clear state transitions
function qaAnalysisReducer(state: QAAnalysisState, action: QAAnalysisAction): QAAnalysisState {
  switch (action.type) {
    case 'ANALYSIS_START':
      return {
        ...state,
        isAnalyzing: true,
        analysisError: null
      };

    case 'ANALYSIS_SUCCESS':
      return {
        ...state,
        isAnalyzing: false,
        analysisError: null,
        analysisResults: action.payload
      };

    case 'ANALYSIS_ERROR':
      return {
        ...state,
        isAnalyzing: false,
        analysisError: action.payload
      };

    case 'ANALYSIS_SKIP':
      return {
        ...state,
        isAnalyzing: false,
        analysisError: null,
        analysisResults: action.payload
      };

    case 'UPDATE_FIXED_ISSUES':
      if (!state.analysisResults) {return state;}

      return {
        ...state,
        analysisResults: {
          ...state.analysisResults,
          fixedIssueIds: [
            ...(state.analysisResults.fixedIssueIds || []),
            ...action.payload
          ]
        }
      };

    default:
      return state;
  }
}

export function useQAAnalysis(appId: string) {
  const [state, dispatch] = useReducer(qaAnalysisReducer, initialState);

  const runAnalysis = useCallback(async () => {
    dispatch({ type: 'ANALYSIS_START' });

    try {
      logger.info('go-live.qa-analysis.start', { appId });

      // Use the agent's qa-analyze endpoint
      const { dynamicApiConfigService } = await import('@/config/dynamic-api');
      const { agentFetch } = await import('@/lib/agent-fetch');
      const { regenerateToken } = await import('@/lib/jwt-regeneration');

      // Regenerate token with fresh permissions
      await regenerateToken({ siteId: appId, force: true });

      // Get agent URL for this site
      const apiConfig = await dynamicApiConfigService.getConfigForSite(appId);
      if (!apiConfig.agentUrl) {
        throw new Error('Agent URL not available for this site');
      }

      const qaUrl = `${apiConfig.agentUrl}/qa-analyze`;

      const response = await agentFetch(qaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          mode: 'semantic',
          forceRefresh: false
        }),
        siteId: appId
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMsg = errorData.error || errorData.details || 'QA analysis failed';
        throw new Error(errorMsg);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'QA analysis failed');
      }

      const result: QAAnalysisResult = {
        success: data.success,
        report: data.report,
        timestamp: data.timestamp,
        runId: data.runId,
        fixedIssueIds: data.fixedIssueIds || []
      };

      dispatch({ type: 'ANALYSIS_SUCCESS', payload: result });

      const totalIssues = data.report?.summary?.total || 0;

      shipAnalyticsLog('go_live.qa_analysis.completed', {
        appId,
        totalIssues,
        errors: data.report?.summary?.errors || 0,
        warnings: data.report?.summary?.warnings || 0
      });

      logger.info('go-live.qa-analysis.success', {
        appId,
        totalIssues,
        summary: data.report?.summary
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      dispatch({ type: 'ANALYSIS_ERROR', payload: errorMessage });
      logger.error('go-live.qa-analysis.failure', { appId, error: errorMessage });
    }
  }, [appId]);

  const skipAnalysis = useCallback(() => {
    logger.info('go-live.qa-analysis.skipped', { appId });

    const mockResult: QAAnalysisResult = {
      success: true,
      report: {
        summary: { total: 0, errors: 0, warnings: 0, suggestions: 0, passed: 0 },
        categories: []
      },
      timestamp: new Date().toISOString(),
      runId: 'skipped'
    };

    dispatch({ type: 'ANALYSIS_SKIP', payload: mockResult });
  }, [appId]);

  const updateFixedIssues = useCallback((newlyFixedIds: string[]) => {
    dispatch({ type: 'UPDATE_FIXED_ISSUES', payload: newlyFixedIds });
  }, []);

  return {
    isAnalyzing: state.isAnalyzing,
    analysisError: state.analysisError,
    analysisResults: state.analysisResults,
    runAnalysis,
    skipAnalysis,
    updateFixedIssues
  };
}
