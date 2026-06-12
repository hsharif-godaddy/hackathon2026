/**
 * Security Analysis API Route
 *
 * Backend API for running security scans via the internal agents service.
 * Handles authentication and provides a secure interface for the frontend.
 */

import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';
import { VulnerabilityScannerResult } from '@/types/vulnerability-scanner';
import { transformVulnerabilityScanResult } from './transform-scan-result';

/**
 * POST /api/security-analysis
 *
 * Run security scans on the app
 *
 * Request body:
 * - appId: string
 * - runTests: ('code')[]
 */
export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext
) => {
  try {
    if (!authContext.jwt) {
      return NextResponse.json(
        { error: 'Authentication token required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { appId, runTests } = body;

    if (!appId || !Array.isArray(runTests)) {
      return NextResponse.json(
        { error: 'Missing required fields: appId, runTests' },
        { status: 400 }
      );
    }

    const supportedTestTypes = new Set(['code']);
    const invalidTestTypes = runTests.filter((testType: string) => !supportedTestTypes.has(testType));
    if (invalidTestTypes.length > 0) {
      return NextResponse.json(
        {
          error: `Unsupported test type(s): ${invalidTestTypes.join(', ')}. Supported values: code.`,
        },
        { status: 400 }
      );
    }

    const adapter = getControlPlaneAdapter();
    logger.info('security-analysis.api.start', { appId, runTests });

    const startTime = Date.now();

    const promises = runTests.map(async function processTest(testType: string) {
      const testStartTime = Date.now();
      let scanEndpoint: string | undefined;
      try {
        logger.info('security-analysis.api.test-start', { testType });

        if (testType === 'code') {
          const site = await adapter.getSite(appId, authContext.jwt);
          if (!site) {
            throw new Error(`Site ${appId} not found`);
          }
          if (!site.agent_url) {
            throw new Error(`Site ${appId} does not have agent URL`);
          }

          // Call agents service for comprehensive security scan (vulnerability + secrets)
          scanEndpoint = `${site.agent_url}/apps/${appId}/vulnerability-scan`;

          const response = await agentFetch(scanEndpoint, {
            siteId: appId,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              production: false,
              skipSecretsScan: false, // Include secrets scan
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.error('security-analysis.api.agent-fetch-failed', {
              appId,
              testType,
              scanEndpoint,
              status: response.status,
              statusText: response.statusText,
            });
            throw new Error(errorData.error || 'Code security scan failed');
          }

          const scanResult = await response.json() as VulnerabilityScannerResult;
          const elapsed = Date.now() - testStartTime;

          // Transform using helper function
          const transformedResult = transformVulnerabilityScanResult(scanResult);

          logger.info('security-analysis.api.test-complete', {
            testType,
            elapsed,
            vulnerabilitiesFound: transformedResult.aiInsights.securityReport.vulnerabilities.length,
          });
          return {
            key: 'code',
            result: {
              results: transformedResult,
              timedOut: false,
              taskId: '',
            },
          };
        }
        return { key: testType, result: null };
      } catch (error) {
        const elapsed = Date.now() - testStartTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        const errorStack = error instanceof Error ? error.stack : undefined;
        const errorCause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;

        logger.error('security-analysis.api.test-failed', {
          testType,
          elapsed,
          error: errorMessage,
          errorName,
          errorCause: String(errorCause),
          errorStack,
          scanEndpoint,
        });
        // Return error information so frontend can display it
        return {
          key: testType,
          result: {
            error: errorMessage,
            status: 'failed'
          }
        };
      }
    });

    logger.info('security-analysis.api.waiting', { message: 'Waiting for all tests to complete...' });
    const testResults = await Promise.all(promises);
    const totalElapsed = Date.now() - startTime;
    logger.info('security-analysis.api.all-complete', { totalElapsed, testCount: testResults.length });

    // Combine results into a single object (include errors)
    const results: Record<string, unknown> = {};
    for (const item of testResults) {
      if (item && item.result) {
        results[item.key] = item.result;
      }
    }

    logger.info('security-analysis.api.complete', { appId, testTypes: runTests, resultKeys: Object.keys(results) });

    return NextResponse.json(results);
  } catch (error) {
    logger.error('security-analysis.api.error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Security Analysis API request failed' },
      { status: 500 }
    );
  }
});
