#!/usr/bin/env node

/**
 * Batch CORS Verification Tool
 * 
 * Tests CORS configuration for multiple production agents in parallel.
 * 
 * Usage:
 *   node scripts/verify-cors-batch.js <app-ids-csv> [options]
 *   
 * Arguments:
 *   app-ids-csv   Comma-separated list of app IDs
 * 
 * Options:
 *   --concurrency N   Number of parallel tests (default: 5)
 *   --verbose         Show detailed output for each test
 *   --help, -h        Show this help message
 * 
 * Examples:
 *   node scripts/verify-cors-batch.js app1,app2,app3
 *   node scripts/verify-cors-batch.js app1,app2,app3 --concurrency 10
 *   node scripts/verify-cors-batch.js app1,app2,app3 --verbose
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

const BASE_URL = 'https://{appId}.agent.c24.airoapp.ai';

class BatchCORSVerifier {
  constructor(appIds, options = {}) {
    this.appIds = appIds;
    this.concurrency = options.concurrency || 5;
    this.verbose = options.verbose || false;
    this.results = [];
    this.testOrigins = [
      { origin: 'https://malicious-site.com', expectedAllowed: false },
      { origin: null, expectedAllowed: true }
    ];
  }

  async makeRequest(url, origin) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers = {
        'User-Agent': 'CORS-Batch-Verifier/1.0'
      };
      
      if (origin) {
        headers['Origin'] = origin;
      }

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname,
        method: 'GET',
        headers: headers,
        timeout: 5000
      };

      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  async testAgent(appId) {
    const url = BASE_URL.replace('{appId}', appId);
    const result = {
      appId,
      url,
      tests: {},
      verdict: 'UNKNOWN',
      errors: []
    };

    if (this.verbose) {
      console.log(`\nTesting ${appId}...`);
    }

    for (const testCase of this.testOrigins) {
      const testKey = testCase.origin || 'no-origin';
      
      try {
        const response = await this.makeRequest(`${url}/health`, testCase.origin);
        
        const corsOrigin = response.headers['access-control-allow-origin'];
        const statusCode = response.statusCode;
        
        let passed = false;
        
        if (statusCode >= 500) {
          passed = null; // Cannot determine
        } else if (!testCase.origin) {
          // No origin = server-to-server, should accept
          passed = statusCode < 500 && statusCode !== 403;
        } else {
          const isAllowed = corsOrigin === testCase.origin || corsOrigin === '*';
          if (testCase.expectedAllowed) {
            passed = isAllowed;
          } else {
            passed = !isAllowed;
          }
        }
        
        result.tests[testKey] = {
          origin: testCase.origin,
          statusCode,
          corsOrigin,
          passed,
          expectedAllowed: testCase.expectedAllowed
        };

        if (this.verbose) {
          const symbol = passed === null ? '⚠️' : (passed ? '✓' : '✗');
          console.log(`  ${symbol} ${testKey}: ${statusCode} ${corsOrigin || '(no CORS headers)'}`);
        }
      } catch (error) {
        result.tests[testKey] = {
          origin: testCase.origin,
          error: error.message,
          passed: false
        };
        result.errors.push(`${testKey}: ${error.message}`);

        if (this.verbose) {
          console.log(`  ✗ ${testKey}: ${error.message}`);
        }
      }
    }

    // Determine overall verdict
    const testResults = Object.values(result.tests);
    const hasFailed = testResults.some(t => t.passed === false);
    const hasSkipped = testResults.some(t => t.passed === null);
    const allPassed = testResults.every(t => t.passed === true);

    if (result.errors.length > 0) {
      result.verdict = 'ERROR';
    } else if (hasFailed) {
      result.verdict = 'FAILED';
    } else if (hasSkipped) {
      result.verdict = 'SKIPPED';
    } else if (allPassed) {
      result.verdict = 'PASSED';
    }

    return result;
  }

  async runBatch() {
    console.log(`Testing ${this.appIds.length} agents with concurrency ${this.concurrency}...\n`);
    
    const startTime = Date.now();
    const queue = [...this.appIds];
    const inProgress = new Set();
    const results = [];

    return new Promise((resolve) => {
      const processNext = () => {
        // Start new tests if under concurrency limit
        while (inProgress.size < this.concurrency && queue.length > 0) {
          const appId = queue.shift();
          const promise = this.testAgent(appId);
          
          inProgress.add(promise);
          
          promise.then(result => {
            results.push(result);
            inProgress.delete(promise);
            
            // Show progress
            if (!this.verbose) {
              const symbol = result.verdict === 'PASSED' ? '✓' : 
                            result.verdict === 'FAILED' ? '✗' :
                            result.verdict === 'SKIPPED' ? '⚠' : '?';
              process.stdout.write(`${symbol}`);
            }
            
            processNext();
          }).catch(error => {
            results.push({
              appId,
              verdict: 'ERROR',
              errors: [error.message]
            });
            inProgress.delete(promise);
            
            if (!this.verbose) {
              process.stdout.write('✗');
            }
            
            processNext();
          });
        }

        // All done
        if (inProgress.size === 0 && queue.length === 0) {
          if (!this.verbose) {
            console.log('\n');
          }
          
          const endTime = Date.now();
          const duration = ((endTime - startTime) / 1000).toFixed(2);
          
          this.results = results;
          this.printSummary(duration);
          resolve(results);
        }
      };

      processNext();
    });
  }

  printSummary(duration) {
    console.log('\n' + '='.repeat(80));
    console.log('BATCH VERIFICATION SUMMARY');
    console.log('='.repeat(80) + '\n');

    const passed = this.results.filter(r => r.verdict === 'PASSED').length;
    const failed = this.results.filter(r => r.verdict === 'FAILED').length;
    const skipped = this.results.filter(r => r.verdict === 'SKIPPED').length;
    const errors = this.results.filter(r => r.verdict === 'ERROR').length;

    console.log(`Total Agents: ${this.results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Duration: ${duration}s`);

    // Show failed agents
    if (failed > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('FAILED AGENTS');
      console.log('='.repeat(80) + '\n');
      
      const failedResults = this.results.filter(r => r.verdict === 'FAILED');
      failedResults.forEach(result => {
        console.log(`${result.appId}: ${result.url}`);
        Object.entries(result.tests).forEach(([key, test]) => {
          if (test.passed === false) {
            console.log(`  ✗ ${key}: Expected ${test.expectedAllowed ? 'allowed' : 'rejected'}, got ${test.corsOrigin || 'no CORS'}`);
          }
        });
      });
    }

    // Show error agents
    if (errors > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('ERROR AGENTS');
      console.log('='.repeat(80) + '\n');
      
      const errorResults = this.results.filter(r => r.verdict === 'ERROR');
      errorResults.forEach(result => {
        console.log(`${result.appId}: ${result.url}`);
        result.errors.forEach(error => {
          console.log(`  ✗ ${error}`);
        });
      });
    }

    // Overall assessment
    console.log('\n' + '='.repeat(80));
    console.log('ASSESSMENT');
    console.log('='.repeat(80) + '\n');

    if (failed > 0) {
      console.log('❌ Some agents have CORS misconfigurations.');
    } else if (errors > 0) {
      console.log('⚠️  Some agents could not be tested due to errors.');
    } else if (skipped > 0) {
      console.log('⚠️  Some agents returned server errors.');
    } else {
      console.log('✅ All agents passed CORS verification!');
    }
    console.log('');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Batch CORS Verification Tool

Usage:
  node scripts/verify-cors-batch.js <app-ids-csv> [options]

Arguments:
  app-ids-csv   Comma-separated list of app IDs

Options:
  --concurrency N   Number of parallel tests (default: 5)
  --verbose         Show detailed output for each test
  --help, -h        Show this help message

Examples:
  node scripts/verify-cors-batch.js app1,app2,app3
  node scripts/verify-cors-batch.js app1,app2,app3 --concurrency 10
  node scripts/verify-cors-batch.js app1,app2,app3 --verbose
`);
  process.exit(0);
}

const appIdsString = args[0];
const appIds = appIdsString.split(',').map(id => id.trim()).filter(id => id.length > 0);

const concurrencyIndex = args.indexOf('--concurrency');
const concurrency = concurrencyIndex !== -1 ? parseInt(args[concurrencyIndex + 1], 10) : 5;
const verbose = args.includes('--verbose') || args.includes('-v');

if (appIds.length === 0) {
  console.error('Error: No app IDs provided');
  process.exit(1);
}

console.log(`Found ${appIds.length} app IDs to test\n`);

const verifier = new BatchCORSVerifier(appIds, { concurrency, verbose });
verifier.runBatch().then(results => {
  const hasCriticalIssues = results.some(r => r.verdict === 'FAILED');
  process.exit(hasCriticalIssues ? 1 : 0);
}).catch(error => {
  console.error('Batch verification failed:', error);
  process.exit(1);
});
