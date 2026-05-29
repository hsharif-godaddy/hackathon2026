import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DevSupervisorClient, DevSupervisorError, isDevSupervisorAvailable, createDevSupervisorClient } from '../DevSupervisorClient.js';
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
      expect(testClient['connectionPath']).toBe(testPath);
    });

    it('should throw if no path provided', () => {
      expect(() => new (DevSupervisorClient as any)()).toThrow(
        'DevSupervisorClient requires an explicit connection path'
      );
    });

    it('should throw if empty path provided', () => {
      expect(() => new DevSupervisorClient('')).toThrow(
        'DevSupervisorClient requires an explicit connection path'
      );
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

      await expect(client.exec(options)).rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError && err.code === 'Command failed' && err.statusCode === 500
      );
    });

    it('should combine error type and message in validation failures', async () => {
      const mockRequest = createMockRequest(400, {
        error: 'validation_failed',
        message: 'command cannot be empty'
      });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      await expect(client.exec({ command: '' })).rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError &&
        err.code === 'validation_failed' &&
        err.statusCode === 400 &&
        err.message === 'command cannot be empty'
      );
    });

    it('should use message field when error field is absent', async () => {
      const mockRequest = createMockRequest(400, {
        message: 'Invalid JSON payload'
      });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      await expect(client.exec({ command: 'test' })).rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError &&
        err.code === 'unknown' &&
        err.statusCode === 400 &&
        err.message === 'Invalid JSON payload'
      );
    });

    it('should fall back to default text when no error details provided', async () => {
      const mockRequest = createMockRequest(400, {});
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      await expect(client.exec({ command: 'test' })).rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError &&
        err.code === 'unknown' &&
        err.statusCode === 400 &&
        err.message === 'Request failed'
      );
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

    it('forwards commandId as command_id query param to scope to a single exec call', async () => {
      const mockRequest = createMockRequest(200, { logs: [] });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      await client.getLogs({ source: 'exec', commandId: 42 });

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/logs?source=exec&command_id=42'
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

    it('should throw if no path provided', () => {
      expect(() => (isDevSupervisorAvailable as any)()).toThrow(
        'isDevSupervisorAvailable requires an explicit connection path'
      );
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

describe('DevSupervisorClient getRaw', () => {
  let client: DevSupervisorClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DevSupervisorClient('/tmp/test.sock');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns buffered data and content type on success', async () => {
    const body = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const mockRequest = createMockStreamRequest(200, body, {
        'content-type': 'image/png',
        'content-length': '4',
      });
      vi.mocked(http.request).mockReturnValue(mockRequest as any);

      const result = await client.getRaw('/workspace/files/download?path=img.png');

      expect(result.contentType).toBe('image/png');
      expect(Buffer.isBuffer(result.data)).toBe(true);
      expect(result.data.length).toBe(4);
      expect(result.data[0]).toBe(0x89);
    });

  it('rejects with parsed error on 404 JSON response', async () => {
    const errorBody = JSON.stringify({ error: 'not_found', message: 'file not found' });
    const mockRequest = createMockStreamRequest(404, Buffer.from(errorBody), {
      'content-type': 'application/json',
    });
    vi.mocked(http.request).mockReturnValue(mockRequest as any);

    await expect(client.getRaw('/workspace/files/download?path=nope'))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError && err.code === 'not_found' && err.statusCode === 404
      );
  });

  it('rejects with raw body on non-JSON error response', async () => {
    const mockRequest = createMockStreamRequest(500, Buffer.from('internal error'), {});
    vi.mocked(http.request).mockReturnValue(mockRequest as any);

    await expect(client.getRaw('/workspace/files/download?path=x'))
      .rejects.toSatisfy((err: unknown) =>
        err instanceof DevSupervisorError && err.statusCode === 500 && err.message === 'internal error'
      );
  });
});

// Helper function to create mock HTTP request that simulates streaming response.
// For success (2xx): emits data/end asynchronously AFTER the response callback fires,
// giving callers time to attach stream listeners.
// For error (non-2xx): emits data/end immediately (consumed inside requestStream).
function createMockStreamRequest(
  statusCode: number,
  body: Buffer,
  headers: Record<string, string>,
) {
  const mockRequest = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  };

  setTimeout(() => {
    const dataCallbacks: Array<(chunk: Buffer) => void> = [];
    const endCallbacks: Array<() => void> = [];

    const mockResponse = {
      statusCode,
      headers,
      on: vi.fn((event: string, callback: (...args: any[]) => void) => {
        if (event === 'data') dataCallbacks.push(callback);
        else if (event === 'end') endCallbacks.push(callback);
        else if (event === 'error') { /* stored but unused */ }
      }),
    };

    const requestCall = vi.mocked(http.request).mock.calls[vi.mocked(http.request).mock.calls.length - 1];
    if (requestCall && requestCall[1]) {
      (requestCall[1] as (res: any) => void)(mockResponse);

      if (statusCode >= 200 && statusCode < 300) {
        // For success: emit data/end asynchronously so callers can attach listeners
        setTimeout(() => {
          for (const cb of dataCallbacks) cb(body);
          for (const cb of endCallbacks) cb();
        }, 0);
      } else {
        // For errors: requestStream consumes the body inline
        for (const cb of dataCallbacks) cb(body);
        for (const cb of endCallbacks) cb();
      }
    }
  }, 0);

  return mockRequest;
}

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