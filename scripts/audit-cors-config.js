#!/usr/bin/env node

/**
 * CORS Configuration Audit Script
 * 
 * Scans the codebase to verify CORS configurations are secure and properly configured.
 * Ensures that:
 * 1. CORS is never "fail open" (allowing all origins in production)
 * 2. ALLOWED_ORIGINS environment variable is required in non-development environments
 * 3. No wildcard (*) origins are used except for public endpoints
 * 4. Development defaults are only used when NODE_ENV=development
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

class CORSAudit {
  constructor() {
    this.issues = [];
    this.warnings = [];
    this.info = [];
  }

  addIssue(severity, file, line, message, context) {
    this.issues.push({ severity, file, line, message, context });
  }

  addWarning(file, line, message, context) {
    this.warnings.push({ file, line, message, context });
  }

  addInfo(file, message) {
    this.info.push({ file, message });
  }

  async scanFile(filePath) {
    // Skip test files, example files, and the audit script itself
    if (filePath.includes('__tests__') || 
        filePath.includes('.test.ts') || 
        filePath.includes('.test.js') ||
        filePath.includes('/examples/') ||
        filePath.includes('audit-cors-config.js') ||
        filePath.includes('verify-cors-production.js')) {
      return;
    }

    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        const trimmed = line.trim();
        
        // Check for wildcard CORS origins
        if (trimmed.includes("'Access-Control-Allow-Origin'") && trimmed.includes("'*'")) {
          // Check if it's in a public endpoint (JWKS is an exception)
          const isJWKS = filePath.includes('jwks.json');
          if (!isJWKS) {
            this.addIssue(
              'HIGH',
              filePath,
              lineNumber,
              'Wildcard CORS origin (*) found outside of public endpoint',
              line
            );
          } else {
            this.addInfo(filePath, 'Wildcard CORS origin allowed for public JWKS endpoint');
          }
        }

        // Check for "fail open" patterns
        if (trimmed.includes('origin: true') || trimmed.includes('origin:true')) {
          this.addIssue(
            'CRITICAL',
            filePath,
            lineNumber,
            'CORS configured to allow all origins (fail open)',
            line
          );
        }

        // Check for development-only fallbacks without environment check
        if (trimmed.includes('localhost:3000') || trimmed.includes('localhost:3001')) {
          const fileContent = content.substring(Math.max(0, content.indexOf(line) - 500), content.indexOf(line) + 500);
          
          if (!fileContent.includes('NODE_ENV') && !fileContent.includes('isDevelopment') && !fileContent.includes('process.env.ALLOWED_ORIGINS')) {
            this.addIssue(
              'MEDIUM',
              filePath,
              lineNumber,
              'Localhost origin configured without environment check',
              line
            );
          }
        }

        // Check for missing ALLOWED_ORIGINS handling
        if (trimmed.includes('cors(') && !content.includes('ALLOWED_ORIGINS')) {
          this.addWarning(
            filePath,
            lineNumber,
            'CORS configuration found without ALLOWED_ORIGINS environment variable handling',
            line
          );
        }

        // Check for origin callback without proper validation
        if (trimmed.includes('origin:') && trimmed.includes('callback')) {
          const hasValidation = content.includes('ALLOWED_ORIGINS') || content.includes('allowedOrigins');
          if (!hasValidation) {
            this.addIssue(
              'HIGH',
              filePath,
              lineNumber,
              'CORS origin callback without proper allowlist validation',
              line
            );
          }
        }
      });
    } catch (error) {
      console.error('Error scanning file:', filePath, error.message);
    }
  }

  async auditAgentsCORS() {
    const corsFile = join(projectRoot, 'agents/src/server/middleware/cors.ts');
    
    try {
      const content = readFileSync(corsFile, 'utf8');
      
      // Check for proper environment variable handling
      if (!content.includes('process.env.ALLOWED_ORIGINS')) {
        this.addIssue(
          'CRITICAL',
          corsFile,
          0,
          'ALLOWED_ORIGINS environment variable not used in CORS configuration',
          ''
        );
      }

      // Check for NODE_ENV check
      if (!content.includes('NODE_ENV')) {
        this.addIssue(
          'HIGH',
          corsFile,
          0,
          'No NODE_ENV check to differentiate development from production',
          ''
        );
      }

      // Check for origin validation callback
      if (!content.includes('origin: (origin, callback)')) {
        this.addIssue(
          'MEDIUM',
          corsFile,
          0,
          'CORS not using origin validation callback',
          ''
        );
      }

      // Verify allowlist checking
      if (!content.includes('.includes(origin)')) {
        this.addIssue(
          'HIGH',
          corsFile,
          0,
          'CORS does not properly validate origin against allowlist',
          ''
        );
      }

      // Check for proper error on invalid origin
      if (!content.includes('callback(new Error')) {
        this.addIssue(
          'HIGH',
          corsFile,
          0,
          'CORS does not reject invalid origins with error callback',
          ''
        );
      }

      this.addInfo(corsFile, 'Main agents CORS configuration audited');
    } catch (error) {
      this.addIssue(
        'CRITICAL',
        corsFile,
        0,
        `Could not read CORS configuration file: ${error.message}`,
        ''
      );
    }
  }

  findFiles(dir, pattern, results = []) {
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        const fullPath = join(dir, file);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('.next') && !file.includes('dist') && !file.includes('build')) {
              this.findFiles(fullPath, pattern, results);
            }
          } else if (file.match(pattern)) {
            results.push(fullPath);
          }
        } catch (error) {
          // Skip files we can't access
        }
      }
    } catch (error) {
      // Skip directories we can't access
    }
    return results;
  }

  async auditDockerConfig() {
    const dockerFiles = this.findFiles(projectRoot, /docker-container-manager\.ts$/);

    for (const fullPath of dockerFiles) {
      const content = readFileSync(fullPath, 'utf8');

      // Check if Docker containers get ALLOWED_ORIGINS env var
      if (content.includes('docker') && !content.includes('ALLOWED_ORIGINS')) {
        this.addWarning(
          fullPath,
          0,
          'Docker configuration does not pass ALLOWED_ORIGINS to containers',
          ''
        );
      }

      this.addInfo(fullPath, 'Docker CORS configuration audited');
    }
  }

  async auditNomadConfig() {
    const nomadFiles = this.findFiles(projectRoot, /job-template\.ts$/);

    for (const fullPath of nomadFiles) {
      const content = readFileSync(fullPath, 'utf8');

      // Check if Nomad jobs get ALLOWED_ORIGINS env var
      if (!content.includes('ALLOWED_ORIGINS')) {
        this.addIssue(
          'HIGH',
          fullPath,
          0,
          'Nomad job template does not include ALLOWED_ORIGINS environment variable',
          ''
        );
      } else {
        this.addInfo(fullPath, 'Nomad job template includes ALLOWED_ORIGINS configuration');
      }
    }
  }

  async run() {
    console.log('🔍 Starting CORS Configuration Audit...\n');

    // Audit main agents CORS configuration
    await this.auditAgentsCORS();

    // Audit Docker configurations
    await this.auditDockerConfig();

    // Audit Nomad configurations
    await this.auditNomadConfig();

    // Scan all TypeScript/JavaScript files for CORS patterns
    const tsFiles = this.findFiles(projectRoot, /\.(ts|js)$/);

    for (const file of tsFiles) {
      await this.scanFile(file);
    }

    // Report results
    this.printReport();
    
    return this.issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH').length === 0;
  }

  printReport() {
    console.log('\n' + '='.repeat(80));
    console.log('CORS CONFIGURATION AUDIT REPORT');
    console.log('='.repeat(80) + '\n');

    // Critical issues
    const criticalIssues = this.issues.filter(i => i.severity === 'CRITICAL');
    if (criticalIssues.length > 0) {
      console.log('🚨 CRITICAL ISSUES (' + criticalIssues.length + '):\n');
      criticalIssues.forEach(issue => {
        console.log(`  File: ${issue.file}${issue.line ? ':' + issue.line : ''}`);
        console.log(`  Issue: ${issue.message}`);
        if (issue.context) {
          console.log(`  Context: ${issue.context.trim()}`);
        }
        console.log();
      });
    }

    // High priority issues
    const highIssues = this.issues.filter(i => i.severity === 'HIGH');
    if (highIssues.length > 0) {
      console.log('⚠️  HIGH PRIORITY ISSUES (' + highIssues.length + '):\n');
      highIssues.forEach(issue => {
        console.log(`  File: ${issue.file}${issue.line ? ':' + issue.line : ''}`);
        console.log(`  Issue: ${issue.message}`);
        if (issue.context) {
          console.log(`  Context: ${issue.context.trim()}`);
        }
        console.log();
      });
    }

    // Medium priority issues
    const mediumIssues = this.issues.filter(i => i.severity === 'MEDIUM');
    if (mediumIssues.length > 0) {
      console.log('⚡ MEDIUM PRIORITY ISSUES (' + mediumIssues.length + '):\n');
      mediumIssues.forEach(issue => {
        console.log(`  File: ${issue.file}${issue.line ? ':' + issue.line : ''}`);
        console.log(`  Issue: ${issue.message}`);
        if (issue.context) {
          console.log(`  Context: ${issue.context.trim()}`);
        }
        console.log();
      });
    }

    // Warnings
    if (this.warnings.length > 0) {
      console.log('⚠️  WARNINGS (' + this.warnings.length + '):\n');
      this.warnings.forEach(warning => {
        console.log(`  File: ${warning.file}${warning.line ? ':' + warning.line : ''}`);
        console.log(`  Warning: ${warning.message}`);
        console.log();
      });
    }

    // Summary
    console.log('='.repeat(80));
    console.log('SUMMARY\n');
    console.log(`  Critical Issues: ${criticalIssues.length}`);
    console.log(`  High Priority Issues: ${highIssues.length}`);
    console.log(`  Medium Priority Issues: ${mediumIssues.length}`);
    console.log(`  Warnings: ${this.warnings.length}`);
    console.log(`  Info: ${this.info.length}`);
    console.log('='.repeat(80) + '\n');

    if (criticalIssues.length === 0 && highIssues.length === 0) {
      console.log('✅ CORS configuration audit passed!\n');
    } else {
      console.log('❌ CORS configuration audit failed. Please address the issues above.\n');
    }

    // Security recommendations
    console.log('='.repeat(80));
    console.log('SECURITY RECOMMENDATIONS\n');
    console.log('1. Always set ALLOWED_ORIGINS environment variable in production');
    console.log('2. Never use wildcard (*) origins except for truly public endpoints');
    console.log('3. Validate origins against an explicit allowlist');
    console.log('4. Use different configurations for development vs production');
    console.log('5. Reject requests from non-allowlisted origins with proper error');
    console.log('6. Include credentials: true only when necessary');
    console.log('7. Set appropriate Access-Control-Max-Age to reduce preflight requests');
    console.log('='.repeat(80) + '\n');
  }
}

// Run audit
const audit = new CORSAudit();
audit.run().then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(error => {
  console.error('Audit failed with error:', error);
  process.exit(1);
});
