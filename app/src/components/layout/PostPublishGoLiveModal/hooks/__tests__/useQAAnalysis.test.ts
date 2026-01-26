/**
 * Tests for useQAAnalysis hook
 */
import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useQAAnalysis } from '../useQAAnalysis';

// Mock dependencies
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn()
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn()
  }
}));

// Mock dynamic imports - must be defined before the imports
const mockAgentFetch = vi.fn();
const mockRegenerateToken = vi.fn();
const mockGetConfigForSite = vi.fn();

// Mock dynamic imports in the hook
vi.mock('@/lib/agent-fetch', async () => ({
  agentFetch: mockAgentFetch
}));

vi.mock('@/lib/jwt-regeneration', async () => ({
  regenerateToken: mockRegenerateToken
}));

vi.mock('@/config/dynamic-api', async () => ({
  dynamicApiConfigService: {
    getConfigForSite: mockGetConfigForSite
  }
}));

describe('useQAAnalysis', () => {
  const mockAppId = 'test-app-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegenerateToken.mockResolvedValue(undefined);
    mockGetConfigForSite.mockResolvedValue({
      agentUrl: 'https://agent.test.com'
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.analysisError).toBeNull();
    expect(result.current.analysisResults).toBeNull();
  });

  it('should handle successful analysis', async () => {
    const mockResponse = {
      success: true,
      report: {
        summary: { total: 5, errors: 2, warnings: 3, suggestions: 0, passed: 10 },
        categories: [
          {
            name: 'Accessibility',
            issues: [
              {
                id: 'issue-1',
                severity: 'error',
                title: 'Missing alt text',
                description: 'Image missing alt attribute'
              }
            ]
          }
        ]
      },
      timestamp: '2024-01-01T00:00:00Z',
      runId: 'run-123',
      fixedIssueIds: []
    };

    mockAgentFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    expect(result.current.isAnalyzing).toBe(false);

    // Trigger analysis
    void result.current.runAnalysis();

    // Wait for completion by checking for results
    await waitFor(() => {
      expect(result.current.analysisResults).not.toBeNull();
    }, { timeout: 3000 });

    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.analysisError).toBeNull();
    expect(result.current.analysisResults).toEqual({
      success: true,
      report: mockResponse.report,
      timestamp: mockResponse.timestamp,
      runId: mockResponse.runId,
      fixedIssueIds: []
    });
  });

  it('should handle analysis error', async () => {
    mockAgentFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Analysis failed' })
    });

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    result.current.runAnalysis();

    await waitFor(() => {
      expect(result.current.analysisError).toBe('Analysis failed');
    }, { timeout: 3000 });

    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.analysisResults).toBeNull();
  });

  it('should handle network error', async () => {
    mockAgentFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    result.current.runAnalysis();

    await waitFor(() => {
      expect(result.current.analysisError).toBe('Network error');
    });

    expect(result.current.isAnalyzing).toBe(false);
    expect(result.current.analysisResults).toBeNull();
  });

  it('should handle skipAnalysis', async () => {
    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    result.current.skipAnalysis();

    await waitFor(() => {
      expect(result.current.analysisResults).not.toBeNull();
    });

    expect(result.current.analysisResults).toEqual({
      success: true,
      report: {
        summary: { total: 0, errors: 0, warnings: 0, suggestions: 0, passed: 0 },
        categories: []
      },
      timestamp: expect.any(String),
      runId: 'skipped'
    });
  });

  it('should update fixed issues', async () => {
    const mockResponse = {
      success: true,
      report: {
        summary: { total: 5, errors: 2, warnings: 3, suggestions: 0, passed: 10 },
        categories: []
      },
      timestamp: '2024-01-01T00:00:00Z',
      runId: 'run-123',
      fixedIssueIds: ['issue-1']
    };

    mockAgentFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    result.current.runAnalysis();

    await waitFor(() => {
      expect(result.current.analysisResults?.fixedIssueIds).toEqual(['issue-1']);
    });

    // Update with more fixed issues
    result.current.updateFixedIssues(['issue-2', 'issue-3']);

    await waitFor(() => {
      expect(result.current.analysisResults?.fixedIssueIds).toEqual([
        'issue-1',
        'issue-2',
        'issue-3'
      ]);
    });
  });

  it('should handle missing agent URL', async () => {
    mockGetConfigForSite.mockResolvedValue({
      agentUrl: undefined
    });

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    result.current.runAnalysis();

    await waitFor(() => {
      expect(result.current.analysisError).toBe('Agent URL not available for this site');
    }, { timeout: 3000 });

    expect(result.current.isAnalyzing).toBe(false);
  });

  it('should handle unsuccessful response data', async () => {
    mockAgentFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Invalid request' })
    });

    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    void result.current.runAnalysis();

    await waitFor(() => {
      expect(result.current.analysisError).toBe('Invalid request');
    }, { timeout: 3000 });

    expect(result.current.isAnalyzing).toBe(false);
  });

  it('should not update fixed issues if no results exist', () => {
    const { result } = renderHook(() => useQAAnalysis(mockAppId));

    // Try to update without results
    result.current.updateFixedIssues(['issue-1']);

    expect(result.current.analysisResults).toBeNull();
  });
});
