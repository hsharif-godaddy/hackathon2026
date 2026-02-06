import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevSupervisorClient, isDevSupervisorAvailable, createDevSupervisorClient } from '../DevSupervisorClient.js';
import * as fs from 'fs';
import http from 'http';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn()
}));

// Mock http module
vi.mock('http');

describe('DevSupervisorClient', () => {
  let client: DevSupervisorClient;
  const mockSocketPath = '/tmp/test-dev-supervisor.sock';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DevSupervisorClient(mockSocketPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use provided socket path', () => {
      const testPath = '/custom/path.sock';
      const testClient = new DevSupervisorClient(testPath);
      expect(testClient['socketPath']).toBe(testPath);
    });

    it('should use environment variable if no path provided', () => {
      const originalEnv = process.env.DEV_SUPERVISOR_SOCKET_PATH;
      process.env.DEV_SUPERVISOR_SOCKET_PATH = '/env/path.sock';
      
      const testClient = new DevSupervisorClient();
      expect(testClient['socketPath']).toBe('/env/path.sock');
      
      process.env.DEV_SUPERVISOR_SOCKET_PATH = originalEnv;
    });

    it('should use default path if no environment variable', () => {
      const originalEnv = process.env.DEV_SUPERVISOR_SOCKET_PATH;
      delete process.env.DEV_SUPERVISOR_SOCKET_PATH;
      
      const testClient = new DevSupervisorClient();
      expect(testClient['socketPath']).toBe('/tmp/dev-supervisor.sock');
      
      process.env.DEV_SUPERVISOR_SOCKET_PATH = originalEnv;
    });
  });

  describe('isAvailable', () => {
    it('should return true when socket exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(client.isAvailable()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketPath);
    });

    it('should return false when socket does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(client.isAvailable()).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith(mockSocketPath);
    });
  });

  describe('exec', () => {
    it('should make correct request for command execution', async () => {
      const mockResponse = {
        command: 'echo test',
        exit_code: 0,
        stdout: 'test\n',
        stderr: '',
        execution_time: 100,
        success: true
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = {
        command: 'echo test',
        working_dir: '/app',
        timeout: 30
      };

      const result = await client.exec(options);

      expect(result).toEqual(mockResponse);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          socketPath: mockSocketPath,
          method: 'POST',
          path: '/exec',
          headers: { 'Content-Type': 'application/json' }
        }),
        expect.any(Function)
      );
    });

    it('should handle command execution errors', async () => {
      const mockRequest = createMockRequest(500, { error: 'Command failed' });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = { command: 'invalid command' };

      await expect(client.exec(options)).rejects.toThrow('HTTP 500: Command failed');
    });

    it('should capture timed_out field from response', async () => {
      const mockResponse = {
        command: 'long-running-command',
        exit_code: -1,
        stdout: '',
        stderr: 'Command timed out',
        execution_time: 30000,
        success: false,
        timed_out: true,
        error: 'Command timed out after 30 seconds'
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = {
        command: 'long-running-command',
        timeout: 30
      };

      const result = await client.exec(options);

      expect(result.timed_out).toBe(true);
      expect(result.error).toBe('Command timed out after 30 seconds');
      expect(result.success).toBe(false);
    });

    it('should not set timed_out when command succeeds', async () => {
      const mockResponse = {
        command: 'echo test',
        exit_code: 0,
        stdout: 'test\n',
        stderr: '',
        execution_time: 100,
        success: true
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = { command: 'echo test' };

      const result = await client.exec(options);

      expect(result.timed_out).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
    });

    it('should capture error field without timeout', async () => {
      const mockResponse = {
        command: 'failing-command',
        exit_code: 1,
        stdout: '',
        stderr: 'Command failed',
        execution_time: 500,
        success: false,
        timed_out: false,
        error: 'Command exited with code 1'
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = { command: 'failing-command' };

      const result = await client.exec(options);

      expect(result.timed_out).toBe(false);
      expect(result.error).toBe('Command exited with code 1');
      expect(result.success).toBe(false);
    });
  });

  describe('startProcess', () => {
    it('should start process and return status', async () => {
      const mockStartResponse = { status: 'started' };
      const mockStatusResponse = {
        pid: 1234,
        command: 'npm run dev',
        state: 'running',
        start_time: '2025-01-01T00:00:00Z'
      };

      // Mock two separate requests: start and status
      let requestCount = 0;
      vi.mocked(http.request).mockImplementation((options: any, callback: any) => {
        requestCount++;
        if (requestCount === 1) {
          // First call is for start
          return createMockRequest(200, mockStartResponse);
        } else {
          // Second call is for status
          return createMockRequest(200, mockStatusResponse);
        }
      });

      const options = {
        command: 'npm run dev',
        working_dir: '/app'
      };

      const result = await client.startProcess(options);
      expect(result).toEqual(mockStatusResponse);
    });
  });

  describe('getProcessStatus', () => {
    it('should return process status', async () => {
      const mockResponse = {
        pid: 1234,
        command: 'npm run dev',
        state: 'running',
        start_time: '2025-01-01T00:00:00Z'
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const result = await client.getProcessStatus();

      expect(result).toEqual(mockResponse);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/process/status'
        }),
        expect.any(Function)
      );
    });
  });

  describe('getLogs', () => {
    it('should get logs with filters', async () => {
      const mockResponse = {
        logs: [
          {
            timestamp: '2025-01-01T00:00:00Z',
            source: 'stdout',
            message: 'Server started'
          }
        ]
      };

      const mockRequest = createMockRequest(200, mockResponse);
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const options = {
        source: 'stdout',
        lines: 50
      };

      const result = await client.getLogs(options);

      expect(result).toEqual(mockResponse.logs);
      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/logs?source=stdout&lines=50'
        }),
        expect.any(Function)
      );
    });
  });

  describe('configureHealthCheck', () => {
    it('should configure health monitoring', async () => {
      const mockRequest = createMockRequest(200, { status: 'configured' });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const healthCheck = {
        type: 'http' as const,
        url: 'http://localhost:3000/health',
        interval: '30s',
        timeout: '10s',
        failure_threshold: 3
      };

      const restartPolicy = {
        enabled: true,
        max_restarts: 5,
        restart_window: '5m'
      };

      await client.configureHealthCheck(healthCheck, restartPolicy);

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: '/health-config'
        }),
        expect.any(Function)
      );
    });
  });
});

describe('utility functions', () => {
  describe('isDevSupervisorAvailable', () => {
    it('should check socket availability', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(isDevSupervisorAvailable('/test/path')).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/test/path');
    });

    it('should use environment variable if no path provided', () => {
      const originalEnv = process.env.DEV_SUPERVISOR_SOCKET_PATH;
      process.env.DEV_SUPERVISOR_SOCKET_PATH = '/env/test.sock';
      
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(isDevSupervisorAvailable()).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/env/test.sock');
      
      process.env.DEV_SUPERVISOR_SOCKET_PATH = originalEnv;
    });
  });

  describe('createDevSupervisorClient', () => {
    it('should create client when available', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const client = createDevSupervisorClient('/test/path');
      expect(client).toBeInstanceOf(DevSupervisorClient);
    });

    it('should return null when not available', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const client = createDevSupervisorClient('/test/path');
      expect(client).toBeNull();
    });
  });
});

// Helper function to create mock HTTP request
function createMockRequest(statusCode: number, responseData: any) {
  const mockRequest = {
    write: vi.fn(),
    end: vi.fn(),
    on: vi.fn((event: string, callback: (...args: any[]) => void) => {
      if (event === 'error') {
        // Store error callback for later use if needed
      }
    })
  };

  // Simulate immediate response
  setTimeout(() => {
    const mockResponse = {
      statusCode,
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        if (event === 'data') {
          callback(JSON.stringify(responseData));
        } else if (event === 'end') {
          callback();
        }
      })
    };

    // Find the response callback from http.request call
    const requestCall = vi.mocked(http.request).mock.calls[vi.mocked(http.request).mock.calls.length - 1];
    if (requestCall && requestCall[1]) {
      requestCall[1](mockResponse);
    }
  }, 0);

  return mockRequest;
}