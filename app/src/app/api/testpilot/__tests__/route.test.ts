/**
 * TestPilot Route Tests
 *
 * Tests the /api/testpilot endpoint to ensure proper handling of vulnerability
 * scanning results, transformation logic, and error cases.
 */

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VulnerabilityScannerResult } from '@/types/vulnerability-scanner';
import { POST } from '../route';
import { transformVulnerabilityScanResult } from '../transform-scan-result';

/**
 * Mock dependencies using vi.hoisted
 */
const { mockAgentFetch, mockTestPilotClient, mockLogger } = vi.hoisted(function setup() {
  return {
    mockAgentFetch: vi.fn(),
    mockTestPilotClient: {
      runVisualTest: vi.fn(),
      runAccessibilityTest: vi.fn(),
      runSecurityTest: vi.fn(),
    },
    mockLogger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

/**
 * Mock agent-fetch
 */
vi.mock('@/lib/agent-fetch', function mockAgentFetchModule() {
  return {
    agentFetch: mockAgentFetch,
  };
});

/**
 * Mock testpilot client
 */
vi.mock('@/lib/testpilot', function mockTestPilotModule() {
  return {
    testPilotClient: mockTestPilotClient,
  };
});

/**
 * Mock logger
 */
vi.mock('@/lib/request-context', function mockLoggerModule() {
  return {
    logger: mockLogger,
  };
});

/**
 * Test fixtures
 */
const MOCK_APP_ID = 'test-app-123';
const MOCK_URL = 'https://test-app.example.com';

/**
 * Helper to create mock NextRequest
 */
function createMockRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/testpilot', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Helper to create mock fetch Response
 */
function createMockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

/**
 * Valid vulnerability scanner result fixture
 */
const VALID_SCAN_RESULT: VulnerabilityScannerResult = {
  success: true,
  executionTime: 5000,
  npmAudit: {
    summary: {
      total: 2,
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
    },
    vulnerabilities: [
      {
        id: 'vuln-1',
        name: 'lodash',
        severity: 'critical',
        via: [{ title: 'Prototype Pollution', cve: 'CVE-2020-8203' }],
        title: 'Prototype Pollution',
        description: 'Versions of lodash prior to 4.17.19 are vulnerable to Prototype Pollution',
      },
      {
        id: 'vuln-2',
        name: 'axios',
        severity: 'high',
        via: ['axios-dependency'],
        description: 'Axios vulnerability',
      },
    ],
  },
  secretsScan: {
    findings: [
      {
        file: 'src/config.ts',
        line: 10,
        column: 15,
        ruleId: 'generic-api-key',
        secret: 'sk-1234...',
        severity: 'high',
        description: 'API key detected',
        remediation: 'Move this secret to environment variables',
      },
    ],
    summary: {
      total: 1,
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
    },
    formattedReport: 'Found 1 secret',
  },
  recommendations: {
    autoFixable: [
      {
        package: 'lodash',
        severity: 'critical',
        fixCommand: 'npm audit fix',
        description: 'Update lodash to version 4.17.19 or later',
      },
    ],
    manualReview: [
      {
        package: 'axios',
        severity: 'high',
        reason: 'Breaking changes in newer versions',
        suggestedAction: 'Review release notes and update carefully',
      },
    ],
    deprecatedReplacements: [
      {
        package: 'request',
        alternative: 'axios or node-fetch',
        reason: 'Package has been deprecated',
      },
    ],
  },
};

describe('testpilot', function packageTests() {
  describe('#POST', function postTests() {
    beforeEach(function resetMocks() {
      vi.clearAllMocks();

      // Set default environment
      process.env.AGENTS_SERVICE_URL = 'http://localhost:4000';
    });

    describe('validation', function validationTests() {
      it('should reject request with missing appId', async function missingAppId() {
        const request = createMockRequest({
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'Missing required fields: appId, url, runTests',
        });
      });

      it('should reject request with missing url', async function missingUrl() {
        const request = createMockRequest({
          appId: MOCK_APP_ID,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'Missing required fields: appId, url, runTests',
        });
      });

      it('should reject request with missing runTests', async function missingRunTests() {
        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'Missing required fields: appId, url, runTests',
        });
      });

      it('should reject request with non-array runTests', async function nonArrayRunTests() {
        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: 'code',
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data).toEqual({
          error: 'Missing required fields: appId, url, runTests',
        });
      });
    });

    describe('code security scan', function codeSecurityTests() {
      it('should successfully transform valid scan result', async function transformValid() {
        mockAgentFetch.mockResolvedValue(createMockResponse(VALID_SCAN_RESULT));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty('code');
        expect(data.code).toMatchObject({
          timedOut: false,
          taskId: expect.any(String),
          results: {
            status: 'completed',
            success: true,
            aiInsights: {
              securityReport: {
                vulnerabilities: expect.arrayContaining([
                  expect.objectContaining({
                    severity: 'critical',
                    title: 'Prototype Pollution',
                    location: 'lodash',
                  }),
                  expect.objectContaining({
                    severity: 'high',
                    title: 'generic-api-key: Hard-coded secret detected',
                    location: 'src/config.ts:10:15',
                  }),
                ]),
                recommendations: expect.arrayContaining([
                  expect.stringContaining('Auto-fixable'),
                  expect.stringContaining('Manual review'),
                  expect.stringContaining('Deprecated'),
                ]),
              },
            },
          },
        });

        expect(mockAgentFetch).toHaveBeenCalledWith(
          'http://localhost:4000/apps/test-app-123/vulnerability-scan',
          expect.objectContaining({
            method: 'POST',
            siteId: MOCK_APP_ID,
          })
        );
      });

      it('should handle scan result with missing npmAudit', async function missingNpmAudit() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          secretsScan: VALID_SCAN_RESULT.secretsScan,
          recommendations: VALID_SCAN_RESULT.recommendations,
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities).toHaveLength(1);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities[0]).toMatchObject({
          severity: 'high',
          title: expect.stringContaining('secret detected'),
        });
      });

      it('should handle scan result with missing secretsScan', async function missingSecretsScan() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: VALID_SCAN_RESULT.npmAudit,
          recommendations: VALID_SCAN_RESULT.recommendations,
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities).toHaveLength(2);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities.every(
          (v: { title?: string }) => !v.title?.includes('secret')
        )).toBe(true);
      });

      it('should handle scan result with missing recommendations', async function missingRecommendations() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: VALID_SCAN_RESULT.npmAudit,
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.recommendations).toEqual([]);
      });

      it('should handle malformed npmAudit vulnerabilities (non-array)', async function malformedNpmAudit() {
        const scanResult = {
          success: true,
          executionTime: 1000,
          npmAudit: {
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
            vulnerabilities: { notAnArray: 'object' }, // Wrong type
          },
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities).toEqual([]);
      });

      it('should handle malformed secretsScan findings (non-array)', async function malformedSecretsScan() {
        const scanResult = {
          success: true,
          executionTime: 1000,
          secretsScan: {
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
            findings: { notAnArray: 'object' }, // Wrong type
            formattedReport: '',
          },
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities).toEqual([]);
      });

      it('should handle empty arrays gracefully', async function emptyArrays() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: {
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
            vulnerabilities: [],
          },
          secretsScan: {
            summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
            findings: [],
            formattedReport: 'No secrets found',
          },
          recommendations: {
            autoFixable: [],
            manualReview: [],
            deprecatedReplacements: [],
          },
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
        expect(data.code.results.aiInsights.securityReport.vulnerabilities).toEqual([]);
        expect(data.code.results.aiInsights.securityReport.recommendations).toEqual([]);
      });

      it('should handle failed scan result', async function failedScan() {
        const scanResult: VulnerabilityScannerResult = {
          success: false,
          executionTime: 1000,
          error: 'npm audit command failed',
        };

        mockAgentFetch.mockResolvedValue(createMockResponse(scanResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.status).toBe('failed');
        expect(data.code.results.success).toBe(false);
        expect(data.code.results.errors).toEqual(['npm audit command failed']);
      });

      it('should handle agent fetch error with error message', async function agentFetchError() {
        const errorResponse = {
          error: 'App not found',
        };
        mockAgentFetch.mockResolvedValue(createMockResponse(errorResponse, false, 404));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code).toMatchObject({
          error: 'App not found',
          status: 'failed',
        });
      });

      it('should handle agent fetch error without error message', async function agentFetchErrorNoMessage() {
        mockAgentFetch.mockResolvedValue(createMockResponse({}, false, 500));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code).toMatchObject({
          error: 'Code security scan failed',
          status: 'failed',
        });
      });

      it('should handle network error gracefully', async function networkError() {
        mockAgentFetch.mockRejectedValue(new Error('Network connection failed'));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.code).toMatchObject({
          error: 'Network connection failed',
          status: 'failed',
        });
      });

      it('should apply remediation from autoFixable recommendations', async function applyRemediation() {
        mockAgentFetch.mockResolvedValue(createMockResponse(VALID_SCAN_RESULT));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        const lodashVuln = data.code.results.aiInsights.securityReport.vulnerabilities.find(
          (v: { location: string }) => v.location === 'lodash'
        );

        expect(lodashVuln.remediation).toEqual([
          'Update lodash to version 4.17.19 or later',
        ]);
      });

      it('should use default remediation when no autoFixable recommendation exists', async function defaultRemediation() {
        mockAgentFetch.mockResolvedValue(createMockResponse(VALID_SCAN_RESULT));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['code'],
        });

        const response = await POST(request);
        const data = await response.json();

        const axiosVuln = data.code.results.aiInsights.securityReport.vulnerabilities.find(
          (v: { location: string }) => v.location === 'axios'
        );

        expect(axiosVuln.remediation).toEqual([
          'Run npm audit fix to resolve this vulnerability',
        ]);
      });
    });

    describe('visual tests', function visualTests() {
      it('should handle visual test successfully', async function visualSuccess() {
        const visualResult = {
          status: 'completed',
          timedOut: false,
          taskId: 'task-123',
        };
        mockTestPilotClient.runVisualTest.mockResolvedValue(visualResult);

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['visual'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.visual).toEqual(visualResult);
        expect(mockTestPilotClient.runVisualTest).toHaveBeenCalledWith(MOCK_URL);
      });
    });

    describe('accessibility tests', function accessibilityTests() {
      it('should handle accessibility test successfully', async function accessibilitySuccess() {
        const accessibilityResult = {
          status: 'completed',
          timedOut: false,
          taskId: 'task-456',
        };
        mockTestPilotClient.runAccessibilityTest.mockResolvedValue(accessibilityResult);

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['accessibility'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.accessibility).toEqual(accessibilityResult);
        expect(mockTestPilotClient.runAccessibilityTest).toHaveBeenCalledWith(MOCK_URL);
      });
    });

    describe('security tests', function securityTests() {
      it('should handle security test successfully', async function securitySuccess() {
        const securityResult = {
          status: 'completed',
          timedOut: false,
          taskId: 'task-789',
        };
        mockTestPilotClient.runSecurityTest.mockResolvedValue(securityResult);

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['security'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.security).toEqual(securityResult);
        expect(mockTestPilotClient.runSecurityTest).toHaveBeenCalledWith(MOCK_URL);
      });
    });

    describe('multiple tests', function multipleTests() {
      it('should run multiple tests in parallel', async function parallelTests() {
        const visualResult = { status: 'completed', timedOut: false, taskId: 'visual-task' };
        const codeResult = VALID_SCAN_RESULT;

        mockTestPilotClient.runVisualTest.mockResolvedValue(visualResult);
        mockAgentFetch.mockResolvedValue(createMockResponse(codeResult));

        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['visual', 'code'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toHaveProperty('visual');
        expect(data).toHaveProperty('code');
        expect(data.visual).toEqual(visualResult);
        expect(data.code.timedOut).toBe(false);
        expect(data.code.results.success).toBe(true);
      });
    });

    describe('transformVulnerabilityScanResult', function transformTests() {
      it('should use Map for efficient remediation lookups', function efficientLookup() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: {
            summary: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
            vulnerabilities: [
              {
                id: 'vuln-1',
                name: 'package-a',
                severity: 'critical',
                via: [],
                description: 'Test vulnerability A',
              },
              {
                id: 'vuln-2',
                name: 'package-b',
                severity: 'high',
                via: [],
                description: 'Test vulnerability B',
              },
            ],
          },
          recommendations: {
            autoFixable: [
              {
                package: 'package-a',
                severity: 'critical',
                fixCommand: 'npm update package-a',
                description: 'Update to version 2.0.0',
              },
            ],
            manualReview: [],
            deprecatedReplacements: [],
          },
        };

        const result = transformVulnerabilityScanResult(scanResult);

        // Verify package-a got the auto-fix recommendation
        const packageAVuln = result.aiInsights.securityReport.vulnerabilities.find(
          v => v.location === 'package-a'
        );
        expect(packageAVuln?.remediation).toEqual(['Update to version 2.0.0']);

        // Verify package-b got the default remediation
        const packageBVuln = result.aiInsights.securityReport.vulnerabilities.find(
          v => v.location === 'package-b'
        );
        expect(packageBVuln?.remediation).toEqual(['Run npm audit fix to resolve this vulnerability']);
      });

      it('should handle empty recommendations array', function emptyRecommendations() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: {
            summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0 },
            vulnerabilities: [
              {
                id: 'vuln-1',
                name: 'test-package',
                severity: 'critical',
                via: [],
                description: 'Test vulnerability',
              },
            ],
          },
          recommendations: {
            autoFixable: [],
            manualReview: [],
            deprecatedReplacements: [],
          },
        };

        const result = transformVulnerabilityScanResult(scanResult);

        // Should use default remediation when no auto-fix is available
        const vuln = result.aiInsights.securityReport.vulnerabilities.find(
          v => v.location === 'test-package'
        );
        expect(vuln?.remediation).toEqual(['Run npm audit fix to resolve this vulnerability']);
      });

      it('should transform all vulnerability fields correctly', function correctTransformation() {
        const scanResult: VulnerabilityScannerResult = {
          success: true,
          executionTime: 1000,
          npmAudit: {
            summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0 },
            vulnerabilities: [
              {
                id: 'vuln-1',
                name: 'lodash',
                severity: 'critical',
                via: [],
                title: 'Prototype Pollution',
                description: 'Lodash vulnerability description',
              },
            ],
          },
          recommendations: {
            autoFixable: [
              {
                package: 'lodash',
                severity: 'critical',
                fixCommand: 'npm audit fix',
                description: 'Update lodash to 4.17.19',
              },
            ],
            manualReview: [],
            deprecatedReplacements: [],
          },
        };

        const result = transformVulnerabilityScanResult(scanResult);

        expect(result.status).toBe('completed');
        expect(result.success).toBe(true);

        const vuln = result.aiInsights.securityReport.vulnerabilities[0];
        expect(vuln.severity).toBe('critical');
        expect(vuln.title).toBe('Prototype Pollution');
        expect(vuln.description).toBe('Lodash vulnerability description');
        expect(vuln.impact).toBe('Vulnerable package: lodash');
        expect(vuln.remediation).toEqual(['Update lodash to 4.17.19']);
        expect(vuln.location).toBe('lodash');
      });
    });

    describe('error handling', function errorTests() {
      it('should handle JSON parse error', async function jsonParseError() {
        const invalidRequest = new NextRequest('http://localhost:3000/api/testpilot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json',
        });

        const response = await POST(invalidRequest);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data).toHaveProperty('error');
      });

      it('should handle unknown test type', async function unknownTestType() {
        const request = createMockRequest({
          appId: MOCK_APP_ID,
          url: MOCK_URL,
          runTests: ['unknown-test'],
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data).toEqual({});
      });
    });
  });
});
