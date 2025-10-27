#!/usr/bin/env node

/**
 * SSE Test Script - Validates Server-Sent Events compliance
 *
 * This script tests the /agent/develop/chat-streaming endpoint to ensure
 * it properly follows the SSE specification (RFC 6455 / HTML5 SSE).
 */

import { EventSource } from 'eventsource';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

class SSETestRunner {
  constructor(baseUrl = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
    this.testResults = [];
    this.appId = null;
  }

  log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  async createTestApp() {
    this.log('\n📱 Creating test app...', 'blue');

    try {
      const response = await fetch(`${this.baseUrl}/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SSE Test App' })
      });

      if (!response.ok) {
        throw new Error(`Failed to create app: ${response.status}`);
      }

      const data = await response.json();
      this.appId = data.app.id;
      this.log(`✅ Test app created: ${this.appId}`, 'green');
      return true;
    } catch (error) {
      this.log(`❌ Failed to create test app: ${error.message}`, 'red');
      return false;
    }
  }

  async testSSECompliance() {
    this.log('\n🔍 Testing SSE compliance...', 'blue');

    return new Promise((resolve) => {
      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        this.testResults.push({
          name: 'Response within reasonable time',
          passed: false,
          actual: 'Timeout after 30 seconds',
          expected: 'Response within 30 seconds'
        });
        resolve();
      }, 30000);
      const events = [];
      const chunks = [];
      let startTime = Date.now();
      let hasMetadata = false;
      let hasContent = false;
      let hasComplete = false;
      let contentChunkCount = 0;

      // Manual fetch to examine raw SSE stream
      fetch(`${this.baseUrl}/agent/develop/chat-streaming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Hello, this is a test message for SSE compliance',
          appId: this.appId
        })
      }).then(response => {
        // Test 1: Check response headers
        this.testResults.push({
          name: 'Content-Type header',
          passed: response.headers.get('content-type') === 'text/event-stream',
          actual: response.headers.get('content-type'),
          expected: 'text/event-stream'
        });

        this.testResults.push({
          name: 'Cache-Control header',
          passed: response.headers.get('cache-control') === 'no-cache',
          actual: response.headers.get('cache-control'),
          expected: 'no-cache'
        });

        this.testResults.push({
          name: 'Connection header',
          passed: response.headers.get('connection') === 'keep-alive',
          actual: response.headers.get('connection'),
          expected: 'keep-alive'
        });

        // Process the stream (Node.js compatible)
        let buffer = '';

        response.body.on('data', (chunk) => {
          const chunkStr = chunk.toString();
          buffer += chunkStr;
          chunks.push(chunkStr);

          // Split on double newlines to separate SSE events
          const events = buffer.split('\n\n');

          // Update buffer with any remaining incomplete event
          buffer = events.pop() || '';

          for (const event of events) {
            if (event.trim()) {
              this.processSSEEvent(event, events);

              // Parse event data
              const lines = event.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));

                    if (data.type === 'metadata') hasMetadata = true;
                    if (data.type === 'content') {
                      hasContent = true;
                      contentChunkCount++;
                    }
                    if (data.type === 'complete') hasComplete = true;

                  } catch (error) {
                    this.testResults.push({
                      name: 'Valid JSON in data field',
                      passed: false,
                      actual: `Parse error: ${error.message}`,
                      expected: 'Valid JSON'
                    });
                  }
                }
              }
            }
          }
        });

        response.body.on('end', () => {
          clearTimeout(timeout);

          // Final validations
          const duration = Date.now() - startTime;

          this.testResults.push({
            name: 'Has metadata event',
            passed: hasMetadata,
            actual: hasMetadata,
            expected: true
          });

          this.testResults.push({
            name: 'Has content events',
            passed: hasContent && contentChunkCount > 0,
            actual: contentChunkCount,
            expected: '> 0'
          });

          this.testResults.push({
            name: 'Has completion event',
            passed: hasComplete,
            actual: hasComplete,
            expected: true
          });

          this.testResults.push({
            name: 'Response time reasonable',
            passed: duration > 100 && duration < 30000, // 100ms to 30s
            actual: `${duration}ms`,
            expected: '100ms - 30000ms'
          });

          resolve();
        });

        response.body.on('error', (error) => {
          clearTimeout(timeout);
          this.testResults.push({
            name: 'Stream read without errors',
            passed: false,
            actual: error.message,
            expected: 'No errors'
          });
          resolve();
        });
      }).catch(error => {
        clearTimeout(timeout);
        this.testResults.push({
          name: 'HTTP request succeeds',
          passed: false,
          actual: error.message,
          expected: 'Successful request'
        });
        resolve();
      });
    });
  }

  processSSEEvent(event, allEvents) {
    const lines = event.split('\n');
    let hasData = false;
    let hasProperFormat = true;

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        hasData = true;
        // Test that data line has content
        if (line.length <= 6) {
          hasProperFormat = false;
        }
      } else if (line.startsWith('id: ') || line.startsWith('event: ') || line.startsWith('retry: ')) {
        // Valid SSE field
      } else if (line.trim() === '') {
        // Empty line is valid
      } else {
        // Invalid line format
        hasProperFormat = false;
      }
    }

    this.testResults.push({
      name: 'SSE event has data field',
      passed: hasData,
      actual: hasData,
      expected: true
    });

    this.testResults.push({
      name: 'SSE event proper format',
      passed: hasProperFormat,
      actual: hasProperFormat,
      expected: true
    });
  }

  async testWithoutAppId() {
    this.log('\n🚫 Testing validation (missing appId)...', 'blue');

    try {
      const response = await fetch(`${this.baseUrl}/agent/develop/chat-streaming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'This should fail without appId'
        })
      });

      // Should get an error response
      const text = await response.text();
      const hasError = text.includes('appId is required');

      this.testResults.push({
        name: 'Validates missing appId',
        passed: hasError,
        actual: hasError ? 'Error returned' : 'No error',
        expected: 'Error about missing appId'
      });

    } catch (error) {
      this.testResults.push({
        name: 'Validation error handling',
        passed: false,
        actual: error.message,
        expected: 'Proper error response'
      });
    }
  }

  async testWithInvalidAppId() {
    this.log('\n🚫 Testing validation (invalid appId)...', 'blue');

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${this.baseUrl}/agent/develop/chat-streaming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'This should fail with invalid appId',
          appId: 'invalid-app-id-12345'
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      const hasError = text.includes('not found') || text.includes('App ') || !response.ok;

      this.testResults.push({
        name: 'Validates invalid appId',
        passed: hasError,
        actual: hasError ? 'Error returned' : 'No error',
        expected: 'Error about app not found'
      });

    } catch (error) {
      const isExpectedError = error.message.includes('not found') ||
                             error.message.includes('App ') ||
                             error.name === 'AbortError';

      this.testResults.push({
        name: 'Invalid appId error handling',
        passed: isExpectedError,
        actual: error.message,
        expected: 'Proper error response or timeout'
      });
    }
  }

  async cleanup() {
    if (this.appId) {
      this.log('\n🧹 Cleaning up test app...', 'blue');
      try {
        await fetch(`${this.baseUrl}/apps/${this.appId}`, {
          method: 'DELETE'
        });
        this.log('✅ Test app deleted', 'green');
      } catch (error) {
        this.log(`⚠️  Failed to delete test app: ${error.message}`, 'yellow');
      }
    }
  }

  printResults() {
    this.log('\n📊 TEST RESULTS', 'cyan');
    this.log('═'.repeat(50), 'cyan');

    let passed = 0;
    let failed = 0;

    for (const result of this.testResults) {
      const status = result.passed ? '✅' : '❌';
      const color = result.passed ? 'green' : 'red';

      this.log(`${status} ${result.name}`, color);

      if (!result.passed) {
        this.log(`   Expected: ${result.expected}`, 'yellow');
        this.log(`   Actual:   ${result.actual}`, 'yellow');
      }

      if (result.passed) passed++;
      else failed++;
    }

    this.log('\n' + '═'.repeat(50), 'cyan');
    this.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`,
             failed === 0 ? 'green' : 'red');

    if (failed === 0) {
      this.log('\n🎉 All tests passed! SSE implementation is compliant.', 'green');
    } else {
      this.log(`\n⚠️  ${failed} test(s) failed. Please review the SSE implementation.`, 'red');
    }

    return failed === 0;
  }

  async run() {
    this.log('🧪 SSE Compliance Test Suite', 'magenta');
    this.log('Testing Server-Sent Events implementation\n', 'magenta');

    // Setup
    const appCreated = await this.createTestApp();
    if (!appCreated) {
      this.log('❌ Cannot proceed without test app', 'red');
      return false;
    }

    try {
      // Run tests
      await this.testWithoutAppId();
      await this.testWithInvalidAppId();
      await this.testSSECompliance();

      // Results
      const allPassed = this.printResults();
      return allPassed;

    } finally {
      await this.cleanup();
    }
  }
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new SSETestRunner();
  tester.run().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export { SSETestRunner };
