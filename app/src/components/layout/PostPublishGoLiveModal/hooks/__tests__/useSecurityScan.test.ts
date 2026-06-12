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

// useTranslations is called inside useSecurityScan via the new templating
// helpers (vulnTitle / vulnDescription). Without an IntlProvider in the test
// tree, useIntl() throws — so mock the hook with a values-aware identity that
// returns one of the substitution values when present (lets "title flows
// through" assertions stay readable) and falls back to the key otherwise.
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values?.title) return String(values.title);
    if (values?.ruleId) return String(values.ruleId);
    if (values?.packageName) return String(values.packageName);
    return key;
  },
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
                  kind: 'sca',
                  severity: 'high',
                  rawTitle: 'SQL Injection Risk',
                  description: 'Potential SQL injection vulnerability',
                  packageName: 'pg'
                },
                {
                  kind: 'sca',
                  severity: 'medium',
                  rawTitle: 'XSS Risk',
                  description: 'Cross-site scripting vulnerability',
                  packageName: 'react-dom'
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
        '/api/security-analysis',
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

  it('should render kind:"sast" with ruleId and rawTitle in vulnTitle', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                {
                  kind: 'sast',
                  severity: 'high',
                  ruleId: 'security/detect-eval-with-expression',
                  rawTitle: 'eval-with-expression',
                  description: 'eval used with non-literal expression',
                  file: 'src/handler.ts',
                  line: 42,
                  column: 5,
                },
              ],
            },
          },
        },
        timedOut: false,
        taskId: 'task-sast',
      },
    };

    mocks.appFetch.mockResolvedValue({ ok: true, json: async () => mockResponse });
    const { result } = renderHook(() => useSecurityScan(mockAppId));
    void result.current.runScan();

    await waitFor(() => expect(mocks.setSecurityScanResults).toHaveBeenCalled(), { timeout: 3000 });

    // The mocked useTranslations returns values.title when present, so the SAST
    // branch (which passes both ruleId + title) shows the title.
    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            title: 'eval-with-expression',
            description: 'eval used with non-literal expression',
          }),
        ]),
      }),
    );
  });

  it('should render kind:"supplyChain" with ruleId/title and surface description', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                {
                  kind: 'supplyChain',
                  severity: 'critical',
                  ruleId: 'lockfile-lint/allowed-hosts',
                  rawTitle: 'Package resolved from disallowed registry',
                  description: 'pkg@1.0.0 resolved from evil.example.com',
                  packageName: 'pkg@1.0.0',
                  file: 'package-lock.json',
                },
              ],
            },
          },
        },
        timedOut: false,
        taskId: 'task-sc',
      },
    };

    mocks.appFetch.mockResolvedValue({ ok: true, json: async () => mockResponse });
    const { result } = renderHook(() => useSecurityScan(mockAppId));
    void result.current.runScan();

    await waitFor(() => expect(mocks.setSecurityScanResults).toHaveBeenCalled(), { timeout: 3000 });

    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({
            severity: 'critical',
            title: 'Package resolved from disallowed registry',
            description: 'pkg@1.0.0 resolved from evil.example.com',
          }),
        ]),
      }),
    );
  });

  it('should render kind:"secret" using ruleId in vulnTitle', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                {
                  kind: 'secret',
                  severity: 'high',
                  ruleId: 'aws-access-key-id',
                  description: 'AWS Access Key ID detected',
                  remediation: ['Rotate the key and move to env vars'],
                  file: 'src/config.ts',
                  line: 10,
                  column: 8,
                },
              ],
            },
          },
        },
        timedOut: false,
        taskId: 'task-secret',
      },
    };

    mocks.appFetch.mockResolvedValue({ ok: true, json: async () => mockResponse });
    const { result } = renderHook(() => useSecurityScan(mockAppId));
    void result.current.runScan();

    await waitFor(() => expect(mocks.setSecurityScanResults).toHaveBeenCalled(), { timeout: 3000 });

    // Mocked useTranslations: secret kind passes only `ruleId`, so the title
    // should be the ruleId value.
    expect(mocks.setSecurityScanResults).toHaveBeenCalledWith(
      mockAppId,
      expect.objectContaining({
        vulnerabilities: expect.arrayContaining([
          expect.objectContaining({
            severity: 'high',
            title: 'aws-access-key-id',
            description: 'AWS Access Key ID detected',
          }),
        ]),
      }),
    );
  });

  it('should map severity levels correctly', async () => {
    const mockResponse = {
      code: {
        results: {
          aiInsights: {
            securityReport: {
              vulnerabilities: [
                { kind: 'sca', severity: 'critical', rawTitle: 'Critical issue', description: 'Desc', packageName: 'pkg-a' },
                { kind: 'sca', severity: 'high', rawTitle: 'High issue', description: 'Desc', packageName: 'pkg-b' },
                { kind: 'sca', severity: 'medium', rawTitle: 'Medium issue', description: 'Desc', packageName: 'pkg-c' },
                { kind: 'sca', severity: 'moderate', rawTitle: 'Moderate issue', description: 'Desc', packageName: 'pkg-d' },
                { kind: 'sca', severity: 'low', rawTitle: 'Low issue', description: 'Desc', packageName: 'pkg-e' }
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
