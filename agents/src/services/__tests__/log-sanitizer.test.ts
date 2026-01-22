import { describe, it, expect, beforeEach } from 'vitest';
import { LogSanitizer, SanitizedLogEntry } from '../log-sanitizer.js';
import type { LogEntry } from '../DevSupervisorClient.js';

describe('LogSanitizer', () => {
  let sanitizer: LogSanitizer;

  beforeEach(() => {
    sanitizer = new LogSanitizer();
  });

  describe('filterByLevel', () => {
    it('should include INFO level logs', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Info message', level: 'info' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Info message');
    });

    it('should include WARN level logs', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Warning message', level: 'warn' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(1);
    });

    it('should include ERROR level logs', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stderr', message: 'Error message', level: 'error' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(1);
    });

    it('should exclude DEBUG level logs', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Debug message', level: 'debug' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(0);
    });

    it('should handle logs without level (default to INFO)', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'No level message' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(1);
    });

    it('should handle case-insensitive levels', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Info 1', level: 'INFO' },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Info 2', level: 'Info' },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Debug', level: 'DEBUG' }
      ];
      const result = sanitizer.filterByLevel(logs);
      expect(result).toHaveLength(2);
    });
  });

  describe('redactSecrets', () => {
    it('should redact OpenAI API keys', () => {
      const message = 'Using OPENAI_API_KEY=sk-abc123xyz789 for request';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('sk-abc123xyz789');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const message = 'Authorization: Bearer fake-test-header.fake-test-payload.fake-test-signature';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('fake-test-header.fake-test-payload.fake-test-signature');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact database connection strings', () => {
      const message = 'Connecting to mysql://user:password123@localhost:3306/mydb';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('password123');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact PostgreSQL connection strings', () => {
      const message = 'DATABASE_URL=postgresql://admin:secretpass@db.example.com:5432/production';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('secretpass');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact JWT tokens', () => {
      // Use fake token starting with eyJ (base64 for '{"') to match JWT pattern
      const message = 'Token: eyJfake.eyJfake.fakesig';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('eyJfake.eyJfake.fakesig');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact generic secret patterns (KEY=value)', () => {
      const message = 'Setting SECRET_KEY=mysupersecretvalue123';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('mysupersecretvalue123');
      expect(result).toContain('[REDACTED]');
    });

    it('should redact AWS keys', () => {
      const message = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('wJalrXUtnFEMI');
      expect(result).toContain('[REDACTED]');
    });

    it('should preserve non-sensitive content', () => {
      const message = 'Build completed successfully in 5.2s';
      const result = sanitizer.redactSecrets(message);
      expect(result).toBe('Build completed successfully in 5.2s');
    });

    it('should handle multiple secrets in one message', () => {
      const message = 'OPENAI_API_KEY=sk-xxx123 and DB_PASSWORD=secret456';
      const result = sanitizer.redactSecrets(message);
      expect(result).not.toContain('sk-xxx123');
      expect(result).not.toContain('secret456');
      expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('sanitizeErrorMessages', () => {
    it('should remove internal stack traces', () => {
      const message = `Error: Something went wrong
    at Object.<anonymous> (/app/node_modules/express/lib/router.js:123:45)
    at Module._compile (node:internal/modules/cjs/loader:1234:14)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;
      const result = sanitizer.sanitizeErrorMessages(message);
      expect(result).not.toContain('node_modules');
      expect(result).not.toContain('node:internal');
      expect(result).toContain('Error: Something went wrong');
    });

    it('should remove internal file paths', () => {
      const message = 'Failed to read /home/airo/apps/abc123/node_modules/package/index.js';
      const result = sanitizer.sanitizeErrorMessages(message);
      expect(result).not.toContain('/home/airo/apps/abc123');
    });

    it('should preserve user-friendly error messages', () => {
      const message = 'Build failed: Missing required dependency "react"';
      const result = sanitizer.sanitizeErrorMessages(message);
      expect(result).toBe('Build failed: Missing required dependency "react"');
    });

    it('should redact internal URLs', () => {
      const message = 'Request to http://internal-service.airo.local:8080/api failed';
      const result = sanitizer.sanitizeErrorMessages(message);
      expect(result).not.toContain('internal-service.airo.local');
    });

    it('should preserve external URLs that customers might need', () => {
      const message = 'Preview available at https://preview-abc123.airo.app';
      const result = sanitizer.sanitizeErrorMessages(message);
      expect(result).toContain('https://preview-abc123.airo.app');
    });

    it('should truncate very long error messages', () => {
      const longMessage = 'Error: ' + 'x'.repeat(2000);
      const result = sanitizer.sanitizeErrorMessages(longMessage);
      expect(result.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('sanitizeLogs (full pipeline)', () => {
    it('should apply all sanitization steps', () => {
      const logs: LogEntry[] = [
        {
          timestamp: '2025-01-22T10:00:00Z',
          source: 'stdout',
          message: 'Starting with OPENAI_API_KEY=sk-secret123',
          level: 'info'
        },
        {
          timestamp: '2025-01-22T10:01:00Z',
          source: 'stderr',
          message: 'Error at /home/internal/path.js:123',
          level: 'error'
        },
        {
          timestamp: '2025-01-22T10:02:00Z',
          source: 'stdout',
          message: 'Debug info here',
          level: 'debug'
        }
      ];

      const result = sanitizer.sanitizeLogs(logs);

      // Should filter out debug
      expect(result).toHaveLength(2);
      // Should redact secrets
      expect(result[0].message).not.toContain('sk-secret123');
      // Should sanitize paths
      expect(result[1].message).not.toContain('/home/internal');
    });

    it('should handle empty log array', () => {
      const result = sanitizer.sanitizeLogs([]);
      expect(result).toEqual([]);
    });

    it('should handle malformed log entries', () => {
      const logs = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Valid' },
        { timestamp: '', source: 'stdout', message: 'Empty timestamp' },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: '' }
      ] as LogEntry[];

      const result = sanitizer.sanitizeLogs(logs);
      // Should handle gracefully without throwing
      expect(Array.isArray(result)).toBe(true);
    });

    it('should preserve timestamp and source', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:30:45Z', source: 'stderr', message: 'Test message', level: 'warn' }
      ];

      const result = sanitizer.sanitizeLogs(logs);

      expect(result[0].timestamp).toBe('2025-01-22T10:30:45Z');
      expect(result[0].source).toBe('stderr');
    });

    it('should normalize log levels to lowercase', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Test', level: 'INFO' },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Test', level: 'WARN' },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stderr', message: 'Test', level: 'ERROR' }
      ];

      const result = sanitizer.sanitizeLogs(logs);

      expect(result[0].level).toBe('info');
      expect(result[1].level).toBe('warn');
      expect(result[2].level).toBe('error');
    });

    it('should default level to info when not specified', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'No level' }
      ];

      const result = sanitizer.sanitizeLogs(logs);

      expect(result[0].level).toBe('info');
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined messages gracefully', () => {
      const logs = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: null as any },
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: undefined as any }
      ] as LogEntry[];

      // Should not throw
      expect(() => sanitizer.sanitizeLogs(logs)).not.toThrow();
    });

    it('should handle special characters in messages', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Test <script>alert("xss")</script>' }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      // Should preserve but not execute (just text sanitization, not HTML encoding)
      expect(result[0].message).toContain('<script>');
    });

    it('should handle unicode in messages', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: 'Build started 🚀 完成' }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result[0].message).toContain('🚀');
      expect(result[0].message).toContain('完成');
    });
  });

  describe('JSON log parsing', () => {
    it('should parse JSON log messages', () => {
      const jsonLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'build.started',
        app_id: 'test123'
      });
      const logs: LogEntry[] = [
        { timestamp: '2026-01-22T05:00:00.000Z', source: 'stdout', message: jsonLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(1);
      expect(result[0].message).toContain('build.started');
      // Should use timestamp from JSON (overrides LogEntry timestamp)
      expect(result[0].timestamp).toBe('2026-01-22T05:46:52.106Z');
    });

    it('should filter out http.request noise logs', () => {
      const httpRequestLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'http.request',
        method: 'GET',
        path: '/node_modules/.vite/deps/react.js',
        status: 200,
        client_ip: '165.1.180.132'
      });
      const buildLog = JSON.stringify({
        time: '2026-01-22T05:46:53.000Z',
        level: 'INFO',
        msg: 'build.completed',
        duration_ms: 5000
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: httpRequestLog },
        { timestamp: '2025-01-22T10:00:01Z', source: 'stdout', message: buildLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      // Should filter out http.request, keep build.completed
      expect(result).toHaveLength(1);
      expect(result[0].message).toContain('build.completed');
    });

    it('should filter out http_request noise logs', () => {
      const httpRequestLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        type: 'http_request',
        method: 'GET',
        path: '/api/health'
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: httpRequestLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(0);
    });

    it('should remove infrastructure fields from JSON logs', () => {
      const jsonLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'server.started',
        client_ip: '165.1.180.132',
        src_ip: '100.64.10.209',
        src_port: '52630',
        ray_id: '9c1cc0db0a0d3ed9-BOM',
        app_id: 'cqtp5h83me',
        port: 3000
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: jsonLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(1);
      // Should not contain infrastructure fields
      expect(result[0].message).not.toContain('165.1.180.132');
      expect(result[0].message).not.toContain('100.64.10.209');
      expect(result[0].message).not.toContain('52630');
      expect(result[0].message).not.toContain('9c1cc0db0a0d3ed9-BOM');
      expect(result[0].message).not.toContain('cqtp5h83me');
      // Should contain server.started
      expect(result[0].message).toContain('server.started');
    });

    it('should extract level from JSON log', () => {
      const warnLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'WARN',
        msg: 'deprecated.api.used'
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: warnLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result[0].level).toBe('warn');
    });

    it('should handle plain text logs alongside JSON logs', () => {
      const jsonLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'build.started'
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: jsonLog },
        { timestamp: '2025-01-22T10:00:01Z', source: 'stdout', message: 'Plain text log message' }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(2);
      expect(result[0].message).toContain('build.started');
      expect(result[1].message).toBe('Plain text log message');
    });

    it('should handle malformed JSON gracefully', () => {
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: '{invalid json' },
        { timestamp: '2025-01-22T10:00:01Z', source: 'stdout', message: 'Valid plain text' }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(2);
      expect(result[0].message).toBe('{invalid json');
      expect(result[1].message).toBe('Valid plain text');
    });

    it('should include path and duration in formatted output', () => {
      const jsonLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'request.completed',
        path: '/api/users',
        status: 200,
        duration_ms: 45
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: jsonLog }
      ];

      const result = sanitizer.sanitizeLogs(logs);
      expect(result[0].message).toContain('request.completed');
      expect(result[0].message).toContain('/api/users');
      expect(result[0].message).toContain('200');
      expect(result[0].message).toContain('45ms');
    });

    it('should allow custom noise message types', () => {
      const customSanitizer = new LogSanitizer({
        noiseMessageTypes: ['http.request', 'health.check', 'metrics.collect']
      });

      const healthLog = JSON.stringify({
        time: '2026-01-22T05:46:52.106Z',
        level: 'INFO',
        msg: 'health.check'
      });
      const logs: LogEntry[] = [
        { timestamp: '2025-01-22T10:00:00Z', source: 'stdout', message: healthLog }
      ];

      const result = customSanitizer.sanitizeLogs(logs);
      expect(result).toHaveLength(0);
    });
  });
});
