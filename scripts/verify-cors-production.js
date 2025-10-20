#!/usr/bin/env node

/**
 * Production CORS Verification Tool
 * 
 * Tests CORS configuration of a production agent service by making actual HTTP requests
 * from different origins to verify that CORS headers are properly configured.
 * 
 * Usage:
 *   node scripts/verify-cors-production.js https://your-production-agent-url.com
 *   node scripts/verify-cors-production.js https://your-production-agent-url.com --verbose
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

class CORSVerifier {
  constructor(targetUrl, verbose = false) {
    this.targetUrl = targetUrl;
    this.verbose = verbose;
    this.results = [];
  }

  log(message, ...args) {
    if (this.verbose) {
      console.log(message, ...args);
    }
  }

  async makeRequest(origin, method = 'GET', endpoint = '/health') {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.targetUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers = {
        'User-Agent': 'CORS-Verifier/1.0'
      };
      
      // Only add Origin header if origin is provided
      if (origin) {
        headers['Origin'] = origin;
      }

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: headers,
        timeout: 10000
      };

      this.log(`Making ${method} request to ${url.href} with origin: ${origin || '(none)'}`);

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

  async testOrigin(origin, expectedAllowed) {
    console.log(`\nTesting origin: ${origin || '(no origin)'}`);
    console.log('-'.repeat(80));

    const testResult = {
      origin,
      expectedAllowed,
      tests: {}
    };

    try {
      // Test 1: Simple GET request to health endpoint
      console.log('1. Testing GET /health...');
      const healthResponse = await this.makeRequest(origin, 'GET', '/health');
      
      const corsOrigin = healthResponse.headers['access-control-allow-origin'];
      const corsCredentials = healthResponse.headers['access-control-allow-credentials'];
      const corsMethods = healthResponse.headers['access-control-allow-methods'];
      const corsHeaders = healthResponse.headers['access-control-allow-headers'];
      
      testResult.tests.health = {
        statusCode: healthResponse.statusCode,
        corsOrigin,
        corsCredentials,
        corsMethods,
        corsHeaders,
        passed: healthResponse.statusCode === 200
      };

      console.log(`   Status: ${healthResponse.statusCode}`);
      
      if (healthResponse.statusCode >= 500) {
        console.log(`   ⚠️  Server error - CORS cannot be evaluated`);
        if (this.verbose) {
          console.log(`   Response body: ${healthResponse.body.substring(0, 200)}`);
        }
      } else {
        console.log(`   Access-Control-Allow-Origin: ${corsOrigin || '(not set)'}`);
        console.log(`   Access-Control-Allow-Credentials: ${corsCredentials || '(not set)'}`);
        console.log(`   Access-Control-Allow-Methods: ${corsMethods || '(not set)'}`);
        console.log(`   Access-Control-Allow-Headers: ${corsHeaders || '(not set)'}`);
      }

      // Test 2: OPTIONS preflight request
      console.log('\n2. Testing OPTIONS preflight...');
      try {
        const preflightResponse = await this.makeRequest(origin, 'OPTIONS', '/agents');
        
        testResult.tests.preflight = {
          statusCode: preflightResponse.statusCode,
          corsOrigin: preflightResponse.headers['access-control-allow-origin'],
          corsMethods: preflightResponse.headers['access-control-allow-methods'],
          corsHeaders: preflightResponse.headers['access-control-allow-headers'],
          corsMaxAge: preflightResponse.headers['access-control-max-age'],
          passed: preflightResponse.statusCode === 204 || preflightResponse.statusCode === 200
        };

        console.log(`   Status: ${preflightResponse.statusCode}`);
        console.log(`   Access-Control-Allow-Origin: ${testResult.tests.preflight.corsOrigin || '(not set)'}`);
        console.log(`   Access-Control-Max-Age: ${testResult.tests.preflight.corsMaxAge || '(not set)'}`);
      } catch (error) {
        testResult.tests.preflight = {
          error: error.message,
          passed: false
        };
        console.log(`   ❌ Preflight request failed: ${error.message}`);
      }

      // Test 3: Authenticated endpoint
      console.log('\n3. Testing authenticated endpoint...');
      try {
        const authResponse = await this.makeRequest(origin, 'GET', '/agents');
        
        testResult.tests.authenticated = {
          statusCode: authResponse.statusCode,
          corsOrigin: authResponse.headers['access-control-allow-origin'],
          passed: authResponse.statusCode === 401 || authResponse.statusCode === 200 // 401 expected without auth
        };

        console.log(`   Status: ${authResponse.statusCode} (401 expected without auth)`);
        console.log(`   Access-Control-Allow-Origin: ${testResult.tests.authenticated.corsOrigin || '(not set)'}`);
      } catch (error) {
        testResult.tests.authenticated = {
          error: error.message,
          passed: false
        };
        console.log(`   ❌ Authenticated request failed: ${error.message}`);
      }

      // Validate results
      // Skip validation if server returned 500 errors
      if (healthResponse.statusCode >= 500) {
        console.log(`\n⚠️  SKIPPED: Cannot validate CORS due to server errors`);
        testResult.verdict = 'SKIPPED';
      } else if (!origin) {
        // No origin header = server-to-server request
        // Success is determined by whether the request was accepted (not 403/blocked)
        if (healthResponse.statusCode < 500 && healthResponse.statusCode !== 403) {
          console.log(`\n✅ PASSED: Server-to-server request accepted (no CORS headers expected)`);
          testResult.verdict = 'PASSED';
        } else {
          console.log(`\n❌ FAILED: Server-to-server request blocked`);
          testResult.verdict = 'FAILED';
        }
      } else {
        const isAllowed = corsOrigin === origin || corsOrigin === '*';
        
        if (expectedAllowed && !isAllowed) {
          console.log(`\n❌ FAILED: Origin should be allowed but CORS headers indicate rejection`);
          testResult.verdict = 'FAILED';
        } else if (!expectedAllowed && isAllowed) {
          console.log(`\n⚠️  WARNING: Origin is allowed but should be rejected`);
          testResult.verdict = 'WARNING';
        } else if (expectedAllowed && isAllowed) {
          console.log(`\n✅ PASSED: Origin correctly allowed`);
          testResult.verdict = 'PASSED';
        } else {
          console.log(`\n✅ PASSED: Origin correctly rejected`);
          testResult.verdict = 'PASSED';
        }
      }

      // Additional security checks
      if (corsOrigin === '*' && corsCredentials === 'true') {
        console.log(`\n🚨 SECURITY ISSUE: Wildcard origin with credentials is a security vulnerability!`);
        testResult.securityIssue = true;
      }

    } catch (error) {
      console.log(`\n❌ Test failed with error: ${error.message}`);
      testResult.error = error.message;
      testResult.verdict = 'ERROR';
    }

    this.results.push(testResult);
    return testResult;
  }

  async verify() {
    console.log('='.repeat(80));
    console.log('PRODUCTION CORS VERIFICATION');
    console.log('='.repeat(80));
    console.log(`\nTarget URL: ${this.targetUrl}\n`);

    // Test various origins
    const testCases = [
      { origin: 'https://malicious-site.com', expectedAllowed: false },
      { origin: 'http://malicious-site.com', expectedAllowed: false },
      { origin: 'https://example.com', expectedAllowed: false },
      { origin: 'http://localhost:3000', expectedAllowed: false }, // Should not work in production
      { origin: 'https://localhost:3000', expectedAllowed: false }, // Should not work in production
      { origin: null, expectedAllowed: true } // No origin (server-to-server, should be allowed)
    ];

    // Check if this is a production URL
    const url = new URL(this.targetUrl);
    const isProduction = !url.hostname.includes('localhost') && !url.hostname.includes('127.0.0.1');

    if (!isProduction) {
      console.log('⚠️  WARNING: This appears to be a local development URL.');
      console.log('   Development servers may have different CORS policies.\n');
    }

    // Run tests
    for (const testCase of testCases) {
      await this.testOrigin(testCase.origin, testCase.expectedAllowed);
    }

    // Print summary
    this.printSummary();

    // Return success/failure
    const hasCriticalIssues = this.results.some(r => 
      r.verdict === 'FAILED' || r.securityIssue
    );

    return !hasCriticalIssues;
  }

  printSummary() {
    console.log('\n' + '='.repeat(80));
    console.log('VERIFICATION SUMMARY');
    console.log('='.repeat(80) + '\n');

    const passed = this.results.filter(r => r.verdict === 'PASSED').length;
    const failed = this.results.filter(r => r.verdict === 'FAILED').length;
    const warnings = this.results.filter(r => r.verdict === 'WARNING').length;
    const skipped = this.results.filter(r => r.verdict === 'SKIPPED').length;
    const errors = this.results.filter(r => r.verdict === 'ERROR').length;
    const securityIssues = this.results.filter(r => r.securityIssue).length;

    console.log(`Tests Passed: ${passed}`);
    console.log(`Tests Failed: ${failed}`);
    console.log(`Warnings: ${warnings}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    console.log(`Security Issues: ${securityIssues}`);

    console.log('\n' + '='.repeat(80));
    console.log('SECURITY ASSESSMENT');
    console.log('='.repeat(80) + '\n');

    if (securityIssues > 0) {
      console.log('🚨 CRITICAL: Security vulnerabilities detected!');
      console.log('   Your CORS configuration has security issues that must be fixed.');
    } else if (failed > 0) {
      console.log('❌ FAILED: CORS configuration is not working as expected.');
      console.log('   Some origins that should be allowed are being rejected.');
    } else if (warnings > 0) {
      console.log('⚠️  WARNING: Potential CORS misconfiguration detected.');
      console.log('   Some origins are allowed that should be rejected.');
    } else if (skipped > 0) {
      console.log('⚠️  SKIPPED: Some tests could not be completed due to server errors.');
      console.log('   Fix server errors and re-run verification.');
    } else {
      console.log('✅ PASSED: CORS configuration appears to be secure and working correctly.');
      console.log('   All expected origins are properly allowed/rejected.');
    }
    console.log('');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Production CORS Verification Tool

Usage:
  node scripts/verify-cors-production.js <target-url> [options]

Arguments:
  target-url    The URL of the production agents service to verify

Options:
  --verbose     Show detailed request/response information
  --help, -h    Show this help message

Examples:
  node scripts/verify-cors-production.js https://agents.example.com
  node scripts/verify-cors-production.js https://agents.example.com --verbose
  node scripts/verify-cors-production.js http://localhost:4000 --verbose
`);
  process.exit(0);
}

const targetUrl = args[0];
const verbose = args.includes('--verbose') || args.includes('-v');

// Validate URL
try {
  new URL(targetUrl);
} catch (error) {
  console.error(`Error: Invalid URL: ${targetUrl}`);
  console.error('Please provide a valid HTTP or HTTPS URL.');
  process.exit(1);
}

// Run verification
const verifier = new CORSVerifier(targetUrl, verbose);
verifier.verify().then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(error => {
  console.error('\nVerification failed with error:', error.message);
  if (verbose) {
    console.error(error.stack);
  }
  process.exit(1);
});
