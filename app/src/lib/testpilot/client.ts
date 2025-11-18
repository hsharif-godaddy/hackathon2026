/**
 * TestPilot AI API Client
 *
 * Provides authenticated access to TestPilot AI testing services including:
 * - Visual testing
 * - Accessibility testing
 * - Security testing
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
 * TestPilot AI API Client
 */
export class Client {

  /**
   * Run a test on the specified URL
   *
   * @param testType - Type of test to run (Visual, Security, accessibility)
   * @param url - URL to test
   * @returns Promise resolving to test results
   *
   * @throws {Error} If API request fails or authentication is invalid
   */
  async runTest(
    testType: TestType,
    url: string
  ): Promise<TestPilotResponse> {
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
      const result = await this.pollTaskResult(token, taskResponse.taskId, testType);

      const elapsed = Date.now() - startTime;

      logger.info('testpilot.run-test.success', {
        testType,
        url,
        totalTests: result.totalTests,
        testsPassed: result.testsPassed,
        testsFailed: result.testsFailed,
        elapsed,
      });

      return result;
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
   * @returns Promise resolving to test results
   *
   * @throws {Error} If polling fails or times out
   */
  private async pollTaskResult(
    token: string,
    taskId: string,
    testType: TestType
  ): Promise<TestPilotResponse> {
    const config = getTestPilotConfig();
    const { maxAttempts, intervalMs } = config.polling;
    const baseUrl = config.apiEndpoint.replace('/ai-run', '');
    const taskUrl = `${baseUrl}/${taskId}`;

    logger.info('testpilot.poll.start', {
      testType,
      taskId,
      maxAttempts,
      intervalMs,
      taskUrl,
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        logger.debug('testpilot.poll.attempt', {
          testType,
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
            testType,
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
          testType,
          taskId,
          attempt,
          status: result.status,
        });

        // Check if task is completed
        if (result.status === 'completed') {
          logger.info('testpilot.poll.completed', {
            testType,
            taskId,
            attempt,
            totalAttempts: attempt,
          });

          // Return the actual result data, not the wrapper
          return result.result ?? result;
        }

        // If still pending and we have attempts left, wait and retry
        if (result.status === 'pending' && attempt < maxAttempts) {
          logger.debug('testpilot.poll.still-pending', {
            testType,
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
            testType,
            taskId,
            attempt,
          });

          throw new Error(`TestPilot test failed with status: ${result.status}`);
        }

        // If we've exhausted attempts and still pending, throw timeout
        if (attempt >= maxAttempts) {
          logger.warn('testpilot.poll.timeout', {
            testType,
            taskId,
            totalAttempts: maxAttempts,
            lastStatus: result.status,
          });

          throw new Error(`TestPilot test timed out after ${maxAttempts} attempts (${maxAttempts * intervalMs / 1000}s)`);
        }
      } catch (error) {
        // If it's the last attempt, throw the error
        if (attempt >= maxAttempts) {
          throw error;
        }

        // Otherwise, log and retry
        logger.warn('testpilot.poll.attempt-error', {
          testType,
          taskId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.sleep(intervalMs);
      }
    }

    // This shouldn't be reached, but just in case
    throw new Error(`TestPilot polling exhausted all ${maxAttempts} attempts`);
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
   * @returns Promise resolving to visual test results
   */
  async runVisualTest(url: string): Promise<TestPilotResponse> {
    return this.runTest('Visual', url);
  }

  /**
   * Run accessibility test
   *
   * @param url - URL to test
   * @returns Promise resolving to accessibility test results
   */
  async runAccessibilityTest(url: string): Promise<TestPilotResponse> {
    return this.runTest('accessibility', url);
  }

  /**
   * Run security test
   *
   * @param url - URL to test
   * @returns Promise resolving to security test results
   */
  async runSecurityTest(url: string): Promise<TestPilotResponse> {
    return this.runTest('Security', url);
  }

  /**
   * Run all tests in parallel
   *
   * @param url - URL to test
   * @returns Promise resolving to all test results
   */
  async runAllTests(
    url: string
  ): Promise<{
    visual: TestPilotResponse;
    accessibility: TestPilotResponse;
    security: TestPilotResponse;
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

