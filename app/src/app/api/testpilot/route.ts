/**
 * TestPilot API Route
 *
 * Backend API for running TestPilot tests and security scans.
 * Handles authentication and provides a secure interface for the frontend.
 */

import { NextRequest, NextResponse } from 'next/server';

import { agentFetch } from '@/lib/agent-fetch';
import { logger } from '@/lib/request-context';
import { testPilotClient } from '@/lib/testpilot';

/**
 * POST /api/testpilot
 *
 * Run TestPilot tests and security scans
 *
 * Request body:
 * - appId: string
 * - url: string
 * - runTests: ('visual' | 'accessibility' | 'security' | 'code')[]
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { appId, url, runTests } = body;

    if (!appId || !url || !Array.isArray(runTests)) {
      return NextResponse.json(
        { error: 'Missing required fields: appId, url, runTests' },
        { status: 400 }
      );
    }

    logger.info('testpilot.api.start', { appId, url, runTests });

    const startTime = Date.now();

    const promises = runTests.map(async function processTest(testType: string) {
      const testStartTime = Date.now();
      try {
        logger.info('testpilot.api.test-start', { testType });

        if (testType === 'visual') {
          const result = await testPilotClient.runVisualTest(url);
          const elapsed = Date.now() - testStartTime;
          logger.info('testpilot.api.test-complete', { 
            testType, 
            elapsed, 
            timedOut: result.timedOut, 
            taskId: result.taskId 
          });
          return { key: 'visual', result };
        } else if (testType === 'accessibility') {
          const result = await testPilotClient.runAccessibilityTest(url);
          const elapsed = Date.now() - testStartTime;
          logger.info('testpilot.api.test-complete', { 
            testType, 
            elapsed, 
            timedOut: result.timedOut, 
            taskId: result.taskId 
          });
          return { key: 'accessibility', result };
        } else if (testType === 'security') {
          const result = await testPilotClient.runSecurityTest(url);
          const elapsed = Date.now() - testStartTime;
          logger.info('testpilot.api.test-complete', { 
            testType, 
            elapsed, 
            timedOut: result.timedOut, 
            taskId: result.taskId 
          });
          return { key: 'security', result };
        } else if (testType === 'code') {
          // Call agents service for code security scan
          const agentUrl = process.env.AGENTS_SERVICE_URL || 'http://localhost:4000';
          const response = await agentFetch(`${agentUrl}/security-scan`, {
            siteId: appId,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              appId,
              production: false,
            }),
          });

          if (!response.ok) {
            throw new Error('Code security scan failed');
          }

          const result = await response.json();
          const elapsed = Date.now() - testStartTime;
          logger.info('testpilot.api.test-complete', { testType, elapsed });
          return { key: 'code', result };
        }
        return { key: testType, result: null };
      } catch (error) {
        const elapsed = Date.now() - testStartTime;
        logger.error('testpilot.api.test-failed', {
          testType,
          elapsed,
          error: error instanceof Error ? error.message : String(error),
        });
        // Return null for failed tests so other tests can continue
        return { key: testType, result: null };
      }
    });

    logger.info('testpilot.api.waiting', { message: 'Waiting for all tests to complete...' });
    const testResults = await Promise.all(promises);
    const totalElapsed = Date.now() - startTime;
    logger.info('testpilot.api.all-complete', { totalElapsed, testCount: testResults.length });

    // Combine results into a single object
    const results: Record<string, unknown> = {};
    for (const item of testResults) {
      if (item && item.result !== null) {
        results[item.key] = item.result;
      }
    }

    logger.info('testpilot.api.complete', { appId, url, testTypes: runTests, resultKeys: Object.keys(results) });

    return NextResponse.json(results);
  } catch (error) {
    logger.error('testpilot.api.error', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'TestPilot API request failed' },
      { status: 500 }
    );
  }
}

