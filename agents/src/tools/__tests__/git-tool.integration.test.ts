/**
 * Git Tool Integration Tests
 * 
 * These tests verify that the GitTool works correctly with real dev-supervisor
 * instances and containerized applications. This test requires a running app
 * with dev-supervisor to function properly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GitTool } from '../git-tool.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { AppRepository } from '../../database/repositories/AppRepository.js';

describe('Git Tool Integration Tests', () => {
  let gitTool: GitTool;
  let testAppId: string | null = null;
  let skipTests = false;
  
  beforeAll(async () => {
    // Find a running app with dev-supervisor available
    const appRepo = new AppRepository();
    const apps = appRepo.findAll();
    
    // Look for a running app with dev-supervisor available
    for (const app of apps) {
      if (DevSupervisorClientFactory.isAvailableForApp(app.id)) {
        testAppId = app.id;
        break;
      }
    }
    
    if (!testAppId) {
      console.warn('No running app with dev-supervisor found. Skipping git tool integration tests.');
      console.warn('To run these tests, start an app with: pnmp run dev:app');
      skipTests = true;
      return;
    }
    
    console.log(`Running git tool integration tests against app: ${testAppId}`);
    
    // Create GitTool instance with dev-supervisor client
    const devSupervisor = DevSupervisorClientFactory.createForApp(testAppId);
    if (!devSupervisor) {
      skipTests = true;
      return;
    }
    
    gitTool = new GitTool(devSupervisor);
  }, 30000);

  afterAll(async () => {
    // Clean up - no cleanup needed for integration tests
  });

  describe('Dev-Supervisor Integration', () => {
    it('should connect to dev-supervisor successfully', async () => {
      if (skipTests) {return;}
      
      expect(testAppId).toBeTruthy();
      const devSupervisor = DevSupervisorClientFactory.createForApp(testAppId!);
      expect(devSupervisor).toBeTruthy();
      expect(devSupervisor!.isAvailable()).toBe(true);
    });

    it('should have a git repository available in the container', async () => {
      if (skipTests) {return;}
      
      const devSupervisor = DevSupervisorClientFactory.createForApp(testAppId!);
      
      // Test raw git command execution
      const result = await devSupervisor!.exec({
        command: 'ls -la /app/.git',
        working_dir: '/app',
        timeout: 10,
        capture_output: true
      });

      expect(result.success).toBe(true);
      expect(result.exit_code).toBe(0);
      // The command lists contents of .git directory, so check for git-specific files
      expect(result.stdout).toMatch(/HEAD|refs|objects|config/);
    }, 10000);
  });

  describe('Git Status Operations', () => {
    it('should successfully get git status', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'status'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('status');
      expect(result.status).toBeDefined();
      expect(result.status!.branch).toBeTruthy();
      expect(typeof result.status!.isClean).toBe('boolean');
      expect(result.output).toBeTruthy();
    }, 15000);

    it('should detect git repository correctly', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Status should work (which means repository detection works)
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'status'
      });

      expect(result.success).toBe(true);
      expect(result.status?.branch).not.toBe('none');
      expect(result.output).not.toContain('Not a git repository');
    }, 10000);
  });

  describe('Git Branch Operations', () => {
    it('should list git branches successfully', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'branch'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('branch');
      expect(result.branches).toBeDefined();
      expect(Array.isArray(result.branches)).toBe(true);
      expect(result.branches!.length).toBeGreaterThan(0);
      expect(result.currentBranch).toBeTruthy();
      expect(result.output).toBeTruthy();
    }, 10000);

    it('should have a valid current branch', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'branch'
      });

      expect(result.success).toBe(true);
      expect(result.currentBranch).toBeTruthy();
      expect(result.branches).toContain(result.currentBranch);
      
      // Common branch names
      expect(['main', 'master', 'develop'].some(branch => 
        result.currentBranch === branch
      )).toBe(true);
    }, 10000);
  });

  describe('Git Diff Operations', () => {
    it('should execute git diff without errors', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'diff'
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('diff');
      expect(result.diff).toBeDefined();
      expect(result.output).toBeDefined();
      // Diff can be empty if no changes, that's ok
    }, 10000);

    it('should handle staged diff option', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'diff',
        options: {
          verbose: true // This enables --staged flag
        }
      });

      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
    }, 10000);
  });

  describe('Git Add Operations', () => {
    it('should execute git add without errors', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Try to add all files (safe operation)
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: ['.'] 
      });

      expect(result.success).toBe(true);
      expect(result.operation).toBe('add');
      expect(result.output).toBeTruthy();
      expect(result.output).toContain('Added files');
    }, 10000);

    it('should handle specific file additions', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Add specific common files that likely exist
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'add',
        files: ['package.json']
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('package.json');
    }, 10000);
  });

  describe('DevSupervisor Client Integration', () => {
    it('should properly set success field based on exit code', async () => {
      if (skipTests) {return;}
      
      const devSupervisor = DevSupervisorClientFactory.createForApp(testAppId!);
      
      // Test a command that should succeed
      const successResult = await devSupervisor!.exec({
        command: 'git --version',
        working_dir: '/app',
        timeout: 10,
        capture_output: true
      });

      expect(successResult.success).toBe(true);
      expect(successResult.exit_code).toBe(0);
      expect(successResult.stdout).toContain('git version');
      
      // Test a command that should fail
      const failResult = await devSupervisor!.exec({
        command: 'git nonexistentcommand',
        working_dir: '/app',
        timeout: 10,
        capture_output: true
      });

      expect(failResult.success).toBe(false);
      expect(failResult.exit_code).not.toBe(0);
      expect(failResult.stderr).toBeTruthy();
    }, 10000);

    it('should handle git commands with proper shell escaping', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Test a git command that uses shell escaping
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'status'
      });

      expect(result.success).toBe(true);
      
      // Verify the command was properly executed (no shell injection issues)
      expect(result.output).toBeTruthy();
      expect(result.status).toBeDefined();
    }, 10000);
  });

  describe('Error Handling', () => {
    it('should handle invalid git operations gracefully', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Test unsupported operation
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'merge' as any
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('not yet supported');
    }, 10000);

    it('should handle git operations with proper error structure', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Test commit operation (may succeed or fail depending on repo state)
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'commit',
        message: 'Test commit'
      });

      // Verify we get a proper response structure
      expect(result.success).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(result.operation).toBe('commit');
      expect(result.output).toBeDefined();
      
      // Response should always have either success output or error details
      expect(result.success || result.error !== undefined).toBe(true);
    }, 10000);
  });

  describe('Performance', () => {
    it('should complete git operations in reasonable time', async () => {
      if (skipTests) {return;}
      
      const startTime = Date.now();
      const appPath = `/tmp/apps/${testAppId}`;
      
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'status'
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    }, 10000);

    it('should handle multiple concurrent git operations', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      
      // Run multiple operations concurrently
      const operations = [
        gitTool.executeGitOperation(appPath, { operation: 'status' }),
        gitTool.executeGitOperation(appPath, { operation: 'branch' }),
        gitTool.executeGitOperation(appPath, { operation: 'diff' })
      ];
      
      const results = await Promise.all(operations);
      
      // All operations should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
      });
    }, 15000);
  });

  describe('Git Tool Formatting', () => {
    it('should format git results properly', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'status'
      });

      expect(result.success).toBe(true);
      
      const formatted = gitTool.formatResult(result);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      expect(formatted).toContain('Git status');
      expect(formatted).toContain('✅'); // Success icon
    }, 10000);

    it('should format error results properly', async () => {
      if (skipTests) {return;}
      
      const appPath = `/tmp/apps/${testAppId}`;
      const result = await gitTool.executeGitOperation(appPath, {
        operation: 'push' as any // Unsupported operation
      });

      expect(result.success).toBe(false);
      
      const formatted = gitTool.formatResult(result);
      expect(formatted).toContain('Git push');
      expect(formatted).toContain('❌'); // Error icon
      expect(formatted).toContain('Error');
    }, 10000);
  });
});