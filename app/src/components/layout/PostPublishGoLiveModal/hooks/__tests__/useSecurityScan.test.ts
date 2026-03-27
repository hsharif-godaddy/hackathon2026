/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useSecurityScan hook
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import { useSecurityScan } from '../useSecurityScan';

// Mock dependencies using vi.hoisted
const mocks = vi.hoisted(() => ({
  appFetch: vi.fn(),
  shipAnalyticsLog: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  setSecurityScanResults: vi.fn(),
  setGoLiveModalStep: vi.fn()
}));

vi.mock('@/lib/gasket-config', () => ({
  appFetch: mocks.appFetch
}));

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: mocks.shipAnalyticsLog
}));

vi.mock('@/lib/request-context', () => ({
  logger: mocks.logger
}));

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => {
    const store = {
      setSecurityScanResults: mocks.setSecurityScanResults,
      setGoLiveModalStep: mocks.setGoLiveModalStep
    };
    return selector ? selector(store) : store;
  }
}));

describe('useSecurityScan', () => {
  const mockAppId = 'test-app-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct default state', () => {
    const { result } = renderHook(() => useSecurityScan(mockAppId));

    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanError).toBeNull();
  });

  it('should handle successful security scan', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                {
                  severity: 'high',
                  title: 'SQL Injection Risk',
                  description: 'Potential SQL injection vulnerability'
                },
                {
                  severity: 'medium',
                  title: 'XSS Risk',
                  description: 'Cross-site scripting vulnerability'
                }
              ]
            }
          }
        },
        timedOut: false,
        taskId: 'task-123'
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(mocks.setSecurityScanResults).toHaveBeenCalled();
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
    expect(result.current.scanError).toBeNull();
    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            title: 'SQL Injection Risk'
          }),
          expect.objectContaining({
            severity: 'moderate', // medium mapped to moderate
            title: 'XSS Risk'
          })
        ]),
        summary: {
          critical: 0,
          high: 1,
          moderate: 1,
          low: 0
        }
      })
    );
  });

  it('should call internal code scan endpoint', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: []
            }
          }
        },
        timedOut: false,
        taskId: ''
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(mocks.appFetch).toHaveBeenCalledWith(
        '/api/testpilot',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            appId: mockAppId,
            runTests: ['code']
          })
        })
      );
    }, { timeout: 3000 });
  });

  it('should handle API error', async () => {
    mocks.appFetch.mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Scan failed' })
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(result.current.scanError).toBe('Security scan failed: Internal Server Error');
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
  });

  it('should handle scan timeout', async () => {
    const mockResponse = {
      code: {
        timedOut: true,
        taskId: 'task-123'
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(result.current.scanError).toBe('Security scan timed out. Please try again.');
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
  });

  it('should handle error response in data', async () => {
    const mockResponse = {
      code: {
        error: 'Invalid URL provided',
        status: 'failed'
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(result.current.scanError).toBe('Invalid URL provided');
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
  });

  it('should handle missing security data in response', async () => {
    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}) // No code field
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(result.current.scanError).toBe(
        'Security scan returned no results. The scan may not have completed successfully.'
      );
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
  });

  it('should set results but not auto-advance when no vulnerabilities found', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: []
            }
          }
        },
        timedOut: false,
        taskId: 'task-123'
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
        mockAppId,
        expect.objectContaining({
          vulnerabilities: [],
          summary: { critical: 0, high: 0, moderate: 0, low: 0 }
        })
      );
    }, { timeout: 3000 });

    // Should NOT auto-advance to video step
    expect(mocks.setGoLiveModalStep).not.toHaveBeenCalled();
    expect(result.current.isScanning).toBe(false);
  });

  it('should handle skipSecurityScan', () => {
    const { result } = renderHook(() => useSecurityScan(mockAppId));

    result.current.skipSecurityScan();

    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: [],
        summary: { critical: 0, high: 0, moderate: 0, low: 0 }
      })
    );
    expect(mocks.setGoLiveModalStep).toHaveBeenCalledWith(mockAppId, 'video');
  });

  it('should map severity levels correctly', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                { severity: 'critical', title: 'Critical issue', description: 'Desc' },
                { severity: 'high', title: 'High issue', description: 'Desc' },
                { severity: 'medium', title: 'Medium issue', description: 'Desc' },
                { severity: 'moderate', title: 'Moderate issue', description: 'Desc' },
                { severity: 'low', title: 'Low issue', description: 'Desc' }
              ]
            }
          }
        },
        timedOut: false,
        taskId: 'task-123'
      }
    };

    mocks.appFetch.mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const { result } = renderHook(() => useSecurityScan(mockAppId));

    void result.current.runScan();

    await waitFor(() => {
      expect(mocks.setSecurityScanResults).toHaveBeenCalled();
    }, { timeout: 3000 });

    expect(result.current.isScanning).toBe(false);
    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({ severity: 'critical' }),
          expect.objectContaining({ severity: 'high' }),
          expect.objectContaining({ severity: 'moderate' }), // medium mapped
          expect.objectContaining({ severity: 'moderate' }), // moderate stays
          expect.objectContaining({ severity: 'low' })
        ]),
        summary: {
          critical: 1,
          high: 1,
          moderate: 2,
          low: 1
        }
      })
    );
  });
});
