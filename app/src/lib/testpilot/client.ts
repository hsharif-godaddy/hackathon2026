/**
 * TestPilot AI API Client
 *
 * Provides authenticated access to TestPilot AI testing services including:
 * - Visual testing
 * - Accessibility testing
 * - Security testing
 *
 * TODO: Implement commit SHA-based caching for results
 *
 * Security scan results should be saved per commit SHA to avoid unnecessary re-runs.
 * This will improve performance and reduce redundant scanning of unchanged code.
 *
 * Implementation considerations:
 * 1. Add commit SHA detection using history
 * 2. Cache scan results in a file using DevSupervisor with commit SHA as key
 * 3. Check cache before running new scans
 * 4. Invalidate cache when new commits are detected
 *
 * Thread: https://godaddy.slack.com/archives/C09AR7XDLDT/p1763670524558059
 */

import { testPilotTokenService } from './token-service';
import { getTestPilotConfig } from './config';
import { logger } from '@/lib/request-context';

/**
 * TestPilot test types
 */
export type TestType = 'Visual' | 'Security' | 'accessibility';

/**
 * TestPilot task creation response
 */
export interface TestPilotTaskResponse {
  taskId: string;
  status: 'pending' | 'completed' | 'failed';
  message: string;
  createdAt: string;
}

/**
 * TestPilot API response interface
 */
export interface TestPilotResponse {
  status?: 'pending' | 'completed' | 'failed';
  success?: boolean;
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
  totalTests?: number;
  passRate?: number;
  testSource?: string;
  details?: Array<{
    name: string;
    status: string;
    duration?: number;
    elementContext?: Record<string, unknown>;
  }>;
  performance?: Record<string, unknown>;
  devTools?: Record<string, unknown>;
  errors?: string[];
  aiInsights?: {
    functional?: Record<string, unknown>;
    securityReport?: {
      vulnerabilities?: Array<{
        severity: string;
        title: string;
        description: string;
        impact?: string;
        remediation?: string[];
        location?: string;
      }>;
      recommendations?: string[];
    };
  };
  visualAnalysis?: {
    issues?: Array<{
      severity: string;
      type: string;
      description: string;
      suggestion?: string;
      location?: string;
    }>;
  };
  accessibilityReport?: {
    overallScore?: number;
    wcagCompliance?: {
      level?: string;
    };
    recommendations?: string[];
    simulationResults?: Array<{
      issues?: Array<{
        severity: string;
        issue: string;
        description?: string;
        message?: string;
        location?: string;
        suggestion?: string;
      }>;
      recommendations?: string[];
    }>;
  };
}

/**
 * TestPilot task polling response interface
 */
interface TestPilotTaskPollResponse {
  taskId: string;
  status: 'pending' | 'completed' | 'failed';
  message?: string;
  result?: TestPilotResponse;
  createdAt?: string;
  completedAt?: string;
}

/**
 * TestPilot runTest result interface
 */
export interface TestPilotRunResult {
  results: TestPilotResponse;
  timedOut: boolean;
  taskId: string;
}

/**
 * TestPilot AI API Client
 */
export class Client {

  /**
   * Run a test on the specified URL
   *
   * @param testType - Type of test to run (Visual, Security, accessibility)
   * @param url - URL to test
   * @returns Promise resolving to test results with timeout and task info
   *
   * @throws {Error} If API request fails or authentication is invalid
   */
  async runTest(
    testType: TestType,
    url: string
  ): Promise<TestPilotRunResult> {
    const startTime = Date.now();

    logger.info('testpilot.run-test.start', {
      testType,
      url,
    });

    try {
      const config = getTestPilotConfig();
      const token = await testPilotTokenService.getToken();

      const formData = new FormData();
      formData.append('url', url);
      formData.append('testType', testType);

      logger.debug('testpilot.run-test.request', {
        testType,
        url,
        apiEndpoint: config.apiEndpoint,
        hasToken: !!token,
        tokenLength: token.length,
        timeout: config.apiTimeout,
      });

      // Step 1: Submit the task
      const submitResponse = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
        signal: AbortSignal.timeout(config.apiTimeout),
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        logger.error('testpilot.run-test.submit-failed', {
          testType,
          url,
          status: submitResponse.status,
          statusText: submitResponse.statusText,
          error: errorText,
        });

        throw new Error(`TestPilot API submission failed: ${submitResponse.status} ${submitResponse.statusText}`);
      }

      const taskResponse: TestPilotTaskResponse = await submitResponse.json();

      logger.info('testpilot.run-test.task-created', {
        testType,
        url,
        taskId: taskResponse.taskId,
        status: taskResponse.status,
      });

      // Step 2: Poll for results
      const pollResult = await this.pollTaskResult(token, taskResponse.taskId);

      const elapsed = Date.now() - startTime;

      if (pollResult.timedOut) {
        logger.warn('testpilot.run-test.timeout', {
          testType,
          url,
          taskId: taskResponse.taskId,
          elapsed,
        });

        return {
          results: {} as TestPilotResponse, // Empty response for timeout
          timedOut: true,
          taskId: taskResponse.taskId,
        };
      }

      logger.info('testpilot.run-test.success', {
        testType,
        url,
        taskId: taskResponse.taskId,
        totalTests: pollResult.result?.totalTests,
        testsPassed: pollResult.result?.testsPassed,
        testsFailed: pollResult.result?.testsFailed,
        elapsed,
      });

      return {
        results: pollResult.result!,
        timedOut: false,
        taskId: taskResponse.taskId,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;

      logger.error('testpilot.run-test.error', {
        testType,
        url,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorCause: error instanceof Error && 'cause' in error ? error.cause : undefined,
        errorStack: error instanceof Error ? error.stack : undefined,
        elapsed,
      });

      throw error;
    }
  }

  /**
   * Poll for task result
   *
   * @param token - Authorization token
   * @param taskId - Task ID to poll
   * @param testType - Type of test (for logging)
   * @returns Promise resolving to test results with timeout status
   *
   * @throws {Error} If polling fails due to network or API errors
   */
  async pollTaskResult(
    token: string,
    taskId: string
  ): Promise<{ result: TestPilotResponse | null; timedOut: boolean }> {
    const config = getTestPilotConfig();
    const { maxAttempts, intervalMs } = config.polling;
    const baseUrl = config.apiEndpoint.replace('/ai-run', '');
    const taskUrl = `${baseUrl}/${taskId}`;

    logger.info('testpilot.poll.start', {
      taskId,
      maxAttempts,
      intervalMs,
      taskUrl,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug('testpilot.poll.attempt', {
          taskId,
          attempt,
          maxAttempts,
        });

        const response = await fetch(taskUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(config.apiTimeout),
        });

        if (!response.ok) {
          logger.warn('testpilot.poll.request-failed', {
            taskId,
            attempt,
            status: response.status,
            statusText: response.statusText,
          });

          // If not found or error, wait and retry
          if (attempt < maxAttempts) {
            await this.sleep(intervalMs);
            continue;
          }

          throw new Error(`TestPilot polling failed: ${response.status} ${response.statusText}`);
        }

        const result: TestPilotTaskPollResponse = await response.json();

        logger.debug('testpilot.poll.response', {
          taskId,
          attempt,
          status: result.status,
        });

        // Check if task is completed
        if (result.status === 'completed') {
          logger.info('testpilot.poll.completed', {
            taskId,
            attempt,
            totalAttempts: attempt,
          });

          // Return the actual result data, not the wrapper
          return { result: result.result ?? result, timedOut: false };
        }

        // If still pending and we have attempts left, wait and retry
        if (result.status === 'pending' && attempt < maxAttempts) {
          logger.debug('testpilot.poll.still-pending', {
            taskId,
            attempt,
            remainingAttempts: maxAttempts - attempt,
          });

          await this.sleep(intervalMs);
          continue;
        }

        // If failed status
        if (result.status === 'failed') {
          logger.error('testpilot.poll.failed', {
            taskId,
            attempt,
          });

          throw new Error(`TestPilot test failed with status: ${result.status}`);
        }

        // If we've exhausted attempts and still pending, return timeout
        if (attempt >= maxAttempts) {
          logger.warn('testpilot.poll.timeout', {
            taskId,
            totalAttempts: maxAttempts,
            lastStatus: result.status,
          });

          return { result: null, timedOut: true };
        }
      } catch (error) {
        // If it's the last attempt, throw the error
        if (attempt >= maxAttempts) {
          throw error;
        }

        // Otherwise, log and retry
        logger.warn('testpilot.poll.attempt-error', {
          taskId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.sleep(intervalMs);
      }
    }

    // This shouldn't be reached, but just in case
    logger.warn('testpilot.poll.exhausted', {
      taskId,
      maxAttempts,
    });
    return { result: null, timedOut: true };
  }

  /**
   * Sleep for a specified duration
   *
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Run visual test
   *
   * @param url - URL to test
   * @returns Promise resolving to visual test results with timeout and task info
   */
  async runVisualTest(url: string): Promise<TestPilotRunResult> {
    return this.runTest('Visual', url);
  }

  /**
   * Run accessibility test
   *
   * @param url - URL to test
   * @returns Promise resolving to accessibility test results with timeout and task info
   */
  async runAccessibilityTest(url: string): Promise<TestPilotRunResult> {
    return this.runTest('accessibility', url);
  }

  /**
   * Run security test
   *
   * @param url - URL to test
   * @returns Promise resolving to security test results with timeout and task info
   */
  async runSecurityTest(url: string): Promise<TestPilotRunResult> {
    return this.runTest('Security', url);
  }

  /**
   * Run all tests in parallel
   *
   * @param url - URL to test
   * @returns Promise resolving to all test results with timeout and task info
   */
  async runAllTests(
    url: string
  ): Promise<{
    visual: TestPilotRunResult;
    accessibility: TestPilotRunResult;
    security: TestPilotRunResult;
  }> {
    logger.info('testpilot.run-all-tests.start', { url });

    const [visual, accessibility, security] = await Promise.all([
      this.runVisualTest(url),
      this.runAccessibilityTest(url),
      this.runSecurityTest(url),
    ]);

    logger.info('testpilot.run-all-tests.complete', { url });

    return { visual, accessibility, security };
  }
}

export const testPilotClient = new Client();

