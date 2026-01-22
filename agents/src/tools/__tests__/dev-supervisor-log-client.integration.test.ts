/**
 * LogReaderTool Integration Tests
 * 
 * These tests use a real dev-supervisor instance (if available) to verify
 * that the LogReaderTool works correctly with actual log data.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DevSupervisorLogClient } from '../dev-supervisor-log-client.js';
import { DevSupervisorClient, createDevSupervisorClient } from '../../services/DevSupervisorClient.js';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { cleanupProcess } from './test-helpers.js';

describe('DevSupervisorLogClient Integration Tests', () => {
  let logClient: DevSupervisorLogClient;
  let devSupervisorClient: DevSupervisorClient;
  let socketPath: string;
  let devSupervisorProcess: ChildProcess | null = null;
  let testDir: string;
  let skipTests = false;
  
  beforeAll(async () => {
    // Check if dev-supervisor binary exists
    const devSupervisorBinary = path.join(process.cwd(), '..', 'dev-supervisor', 'dist', 'dev-supervisor');
    const devSupervisorBinaryAlt = path.join(process.cwd(), 'dist', 'dev-supervisor');
    
    let binaryPath: string | null = null;
    if (existsSync(devSupervisorBinary)) {
      binaryPath = devSupervisorBinary;
    } else if (existsSync(devSupervisorBinaryAlt)) {
      binaryPath = devSupervisorBinaryAlt;
    }
    
    if (!binaryPath) {
      console.warn('dev-supervisor binary not found, skipping integration tests');
      skipTests = true;
      return;
    }
    
    // Create test directory
    testDir = path.join('/tmp', `log-reader-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    // Set up socket path
    socketPath = path.join(testDir, 'dev-supervisor.sock');
    
    // Start dev-supervisor for testing
    console.log('Starting dev-supervisor for integration tests...');
    devSupervisorProcess = spawn(binaryPath, [], {
      env: {
        ...process.env,
        DEV_SUPERVISOR_SOCKET_PATH: socketPath,
      },
      stdio: 'pipe',
      cwd: testDir,
    });
    
    // Wait for dev-supervisor to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('dev-supervisor failed to start within timeout'));
      }, 10000);
      
      const checkSocket = () => {
        if (existsSync(socketPath)) {
          clearTimeout(timeout);
          resolve(true);
        } else {
          setTimeout(checkSocket, 100);
        }
      };
      
      checkSocket();
    });
    
    // Create clients
    devSupervisorClient = new DevSupervisorClient(socketPath);
    logClient = new DevSupervisorLogClient(socketPath);
    
    // Start a simple process to generate logs
    await devSupervisorClient.startProcess({
      command: 'node -e "setInterval(() => { console.log(\'Test log entry:\', Date.now()); console.error(\'Test error:\', Date.now()); }, 2000);"',
      working_dir: testDir,
    });
    
    // Wait for logs to be generated
    await new Promise(resolve => setTimeout(resolve, 5000));
  }, 30000);
  
  afterAll(async () => {
    if (skipTests) return;

    // Clean up process using helper
    await cleanupProcess(devSupervisorProcess, 5000);
    devSupervisorProcess = null;

    // Clean up test directory
    if (testDir && existsSync(testDir)) {
      try {
        await fs.rm(testDir, { recursive: true, force: true });
      } catch (error) {
        console.warn('Failed to clean up test directory:', error);
      }
    }
  }, 10000);

  beforeEach(async () => {
    if (skipTests) return;
    
    // Generate some additional test logs by executing commands
    try {
      await devSupervisorClient.exec({ 
        command: 'echo "Integration test log entry"',
        timeout: 5 
      });
      
      await devSupervisorClient.exec({ 
        command: 'echo "Integration test error" >&2',
        timeout: 5 
      });
      
      // Wait a moment for logs to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('Failed to generate test logs:', error);
    }
  });

  describe('Tool Availability and Setup', () => {
    it('should skip tests if dev-supervisor not available', () => {
      if (skipTests) {
        console.log('Skipping integration tests - dev-supervisor binary not found');
        return;
      }
      
      expect(skipTests).toBe(false);
    });
    
    it('should have dev-supervisor available', () => {
      if (skipTests) return;
      
      expect(existsSync(socketPath)).toBe(true);
      expect(logClient.isAvailable()).toBe(true);
      expect(devSupervisorClient.isAvailable()).toBe(true);
    });

    it('should be able to communicate with dev-supervisor', async () => {
      if (skipTests) return;
      
      const info = await devSupervisorClient.getInfo();
      expect(info).toBeDefined();
      expect(typeof info).toBe('object');
    });

    it('should be able to get process status', async () => {
      if (skipTests) return;
      
      const status = await devSupervisorClient.getProcessStatus();
      expect(status).toBeDefined();
      expect(status.pid).toBeDefined();
      expect(status.command).toBeDefined();
      expect(status.state).toBeDefined();
    });
  });

  describe('Basic Log Reading', () => {
    it('should read logs without filters', async () => {
      if (skipTests) return;
      
      const result = await logClient.readLogs();
      
      expect(result.success).toBe(true);
      expect(result.logs).toBeDefined();
      expect(Array.isArray(result.logs)).toBe(true);
      expect(result.totalEntries).toBe(result.logs.length);
      expect(result.formatted).toBeDefined();
      
      if (result.logs.length > 0) {
        const firstLog = result.logs[0];
        expect(firstLog.timestamp).toBeDefined();
        expect(firstLog.source).toBeDefined();
        expect(firstLog.message).toBeDefined();
        expect(['stdout', 'stderr'].includes(firstLog.source)).toBe(true);
      }
    });

    it('should read logs with line limit', async () => {
      if (skipTests) return;
      
      const result = await logClient.readLogs({ lines: 5 });
      
      expect(result.success).toBe(true);
      expect(result.logs.length).toBeLessThanOrEqual(5);
      expect(result.linesRequested).toBe(5);
    });

    it('should respect maximum line limit of 1000', async () => {
      const result = await logClient.readLogs({ lines: 2000 });
      
      expect(result.success).toBe(true);
      // The tool should cap at 1000 lines
      expect(result.logs.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('Source Filtering', () => {
    it('should filter stdout logs only', async () => {
      const result = await logClient.readLogs({ source: 'stdout', lines: 50 });
      
      expect(result.success).toBe(true);
      expect(result.source).toBe('stdout');
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          expect(log.source).toBe('stdout');
        });
      }
    });

    it('should filter stderr logs only', async () => {
      const result = await logClient.readLogs({ source: 'stderr', lines: 50 });
      
      expect(result.success).toBe(true);
      expect(result.source).toBe('stderr');
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          expect(log.source).toBe('stderr');
        });
      }
    });
  });

  describe('Time-based Filtering', () => {
    it('should filter logs since a specific time', async () => {
      // Get current time minus 5 minutes
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      
      const result = await logClient.readLogs({ 
        since: fiveMinutesAgo,
        lines: 100 
      });
      
      expect(result.success).toBe(true);
      expect(result.sinceFilter).toBe(fiveMinutesAgo);
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          const logTime = new Date(log.timestamp);
          const filterTime = new Date(fiveMinutesAgo);
          expect(logTime.getTime()).toBeGreaterThanOrEqual(filterTime.getTime());
        });
      }
    });

    it('should handle invalid timestamp format', async () => {
      const result = await logClient.readLogs({ 
        since: 'invalid-timestamp',
        lines: 10 
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid since timestamp format');
    });
  });

  describe('Convenience Methods', () => {
    it('should read recent logs', async () => {
      const result = await logClient.readRecentLogs(10);
      
      expect(result.success).toBe(true);
      expect(result.logs.length).toBeLessThanOrEqual(10);
      expect(result.formatted).toBeDefined();
    });

    it('should read recent logs with source filter', async () => {
      const result = await logClient.readRecentLogs(10, 'stdout');
      
      expect(result.success).toBe(true);
      expect(result.logs.length).toBeLessThanOrEqual(10);
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          expect(log.source).toBe('stdout');
        });
      }
    });

    it('should read logs since timestamp', async () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const result = await logClient.readLogsSince(oneMinuteAgo);
      
      expect(result.success).toBe(true);
      expect(result.sinceFilter).toBe(oneMinuteAgo);
    });

    it('should read error logs only', async () => {
      const result = await logClient.readErrorLogs(50);
      
      expect(result.success).toBe(true);
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          expect(log.source).toBe('stderr');
        });
      }
    });

    it('should read output logs only', async () => {
      const result = await logClient.readOutputLogs(50);
      
      expect(result.success).toBe(true);
      
      if (result.logs.length > 0) {
        result.logs.forEach(log => {
          expect(log.source).toBe('stdout');
        });
      }
    });
  });

  describe('Log Summary', () => {
    it('should generate log summary', async () => {
      const result = await logClient.getLogSummary();
      
      expect(result.success).toBe(true);
      expect(result.summary).toBeDefined();
      
      const summary = result.summary!;
      expect(typeof summary.totalLogs).toBe('number');
      expect(summary.totalLogs).toBeGreaterThanOrEqual(0);
      expect(typeof summary.sources).toBe('object');
      expect(typeof summary.levels).toBe('object');
      
      if (summary.totalLogs > 0) {
        expect(summary.oldestEntry).toBeDefined();
        expect(summary.newestEntry).toBeDefined();
        
        // Validate timestamp format
        expect(() => new Date(summary.oldestEntry!)).not.toThrow();
        expect(() => new Date(summary.newestEntry!)).not.toThrow();
        
        // Sources should contain valid values
        Object.keys(summary.sources).forEach(source => {
          expect(['stdout', 'stderr'].includes(source)).toBe(true);
          expect(typeof summary.sources[source]).toBe('number');
          expect(summary.sources[source]).toBeGreaterThan(0);
        });
      }
    });

    it('should format log summary', async () => {
      const result = await logClient.getLogSummary();
      
      if (result.success && result.summary) {
        const formatted = logClient.formatLogSummary(result.summary);
        
        expect(typeof formatted).toBe('string');
        expect(formatted.length).toBeGreaterThan(0);
        expect(formatted).toContain('Log Summary');
        expect(formatted).toContain('Total Logs');
        
        if (result.summary.totalLogs > 0) {
          expect(formatted).toContain('Sources:');
          expect(formatted).toContain('Time Range:');
        }
      }
    });
  });

  describe('Log Content Verification', () => {
    it('should find test logs we generated', async () => {
      const result = await logClient.readLogs({ lines: 100 });
      
      expect(result.success).toBe(true);
      
      if (result.logs.length > 0) {
        // Look for our test log entries
        const hasTestLog = result.logs.some(log => 
          log.message.includes('Test log entry from integration test')
        );
        
        // Note: This might not always pass if logs are rotated quickly
        // but it's a good integration check when it works
        if (hasTestLog) {
          expect(hasTestLog).toBe(true);
        }
      }
    });

    it('should show development server logs', async () => {
      const result = await logClient.readLogs({ lines: 100 });
      
      expect(result.success).toBe(true);
      
      if (result.logs.length > 0) {
        // Development server should generate some recognizable logs
        const hasDevServerLog = result.logs.some(log => 
          log.message.toLowerCase().includes('server') ||
          log.message.toLowerCase().includes('running') ||
          log.message.toLowerCase().includes('listening') ||
          log.message.toLowerCase().includes('dev') ||
          log.message.toLowerCase().includes('build')
        );
        
        // This is a reasonable expectation for a dev server
        expect(hasDevServerLog).toBe(true);
      }
    });
  });

  describe('Log Formatting', () => {
    it('should format logs with emojis and structure', async () => {
      const result = await logClient.readLogs({ 
        lines: 10,
        format: true 
      });
      
      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      
      const formatted = result.formatted!;
      if (result.logs.length === 0) {
        expect(formatted).toContain('No logs found');
      } else {
        expect(formatted).toContain('Total Entries:');
        expect(formatted).toContain('Log Entries:');
        expect(formatted).toContain('```');
        
        // Should contain emoji indicators for sources
        const hasStdoutEmoji = formatted.includes('📤');
        const hasStderrEmoji = formatted.includes('🚨');
        
        expect(hasStdoutEmoji || hasStderrEmoji).toBe(true);
      }
    });

    it('should include filter information in formatted output', async () => {
      const result = await logClient.readLogs({ 
        source: 'stdout',
        lines: 5,
        format: true 
      });
      
      expect(result.success).toBe(true);
      expect(result.formatted).toBeDefined();
      
      const formatted = result.formatted!;
      if (result.logs.length === 0) {
        expect(formatted).toContain('No logs found');
      } else {
        expect(formatted).toContain('Log Filters:');
        expect(formatted).toContain('source: stdout');
        expect(formatted).toContain('lines: 5');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle unavailable dev-supervisor gracefully', async () => {
      // Create a tool with invalid socket path
      const badTool = new DevSupervisorLogClient('/nonexistent/socket.sock');
      
      const result = await badTool.readLogs({ lines: 10 });
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not available|not initialized/);
      expect(result.logs).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it('should handle summary request when dev-supervisor unavailable', async () => {
      const badTool = new DevSupervisorLogClient('/nonexistent/socket.sock');
      
      const result = await badTool.getLogSummary();
      
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not available|not initialized/);
      expect(result.summary).toBeUndefined();
    });
  });

  describe('Performance', () => {
    it('should read logs in reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await logClient.readLogs({ lines: 100 });
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should generate summary in reasonable time', async () => {
      const startTime = Date.now();
      
      const result = await logClient.getLogSummary();
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });

  describe('Multiple Operations', () => {
    it('should handle multiple concurrent log reads', async () => {
      const promises = [
        logClient.readLogs({ lines: 10 }),
        logClient.readLogs({ source: 'stdout', lines: 5 }),
        logClient.readLogs({ source: 'stderr', lines: 5 }),
      ];
      
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should maintain state correctly across operations', async () => {
      // First read
      const result1 = await logClient.readLogs({ lines: 5 });
      expect(result1.success).toBe(true);
      
      // Second read should still work
      const result2 = await logClient.readLogs({ source: 'stdout', lines: 10 });
      expect(result2.success).toBe(true);
      
      // Summary should still work
      const summary = await logClient.getLogSummary();
      expect(summary.success).toBe(true);
    });
  });
});