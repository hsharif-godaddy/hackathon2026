import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyPortReplacements, injectPortHandling } from '../ExpressPortInjector.js';

// Mock Logger
vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe('ExpressPortInjector', () => {
  describe('applyPortReplacements', () => {
    describe('PORT variable declarations', () => {
      it('should replace const PORT = 3000 with process.env.PORT fallback', () => {
        const input = 'const PORT = 3000;';
        const output = applyPortReplacements(input);
        expect(output).toBe('const PORT = process.env.PORT || 3000;');
      });

      it('should replace let port = 8080 with process.env.PORT fallback', () => {
        const input = 'let port = 8080;';
        const output = applyPortReplacements(input);
        expect(output).toBe('let port = process.env.PORT || 8080;');
      });

      it('should replace var PORT = 5000 with process.env.PORT fallback', () => {
        const input = 'var PORT = 5000;';
        const output = applyPortReplacements(input);
        expect(output).toBe('var PORT = process.env.PORT || 5000;');
      });

      it('should handle PORT with different spacing', () => {
        const input = 'const  PORT  =  3000;';
        const output = applyPortReplacements(input);
        // The regex normalizes spacing, which is acceptable
        expect(output).toContain('process.env.PORT || 3000');
      });
    });

    describe('listen() with port number only', () => {
      it('should replace .listen(3000) with PORT and host', () => {
        const input = 'app.listen(3000);';
        const output = applyPortReplacements(input);
        expect(output).toBe("app.listen(process.env.PORT || 3000, '0.0.0.0');");
      });

      it('should replace server.listen(8080) with PORT and host', () => {
        const input = 'server.listen(8080);';
        const output = applyPortReplacements(input);
        expect(output).toBe("server.listen(process.env.PORT || 8080, '0.0.0.0');");
      });

      it('should handle listen with spaces', () => {
        const input = 'app.listen( 3000 );';
        const output = applyPortReplacements(input);
        expect(output).toBe("app.listen(process.env.PORT || 3000, '0.0.0.0');");
      });
    });

    describe('listen() with localhost/127.0.0.1', () => {
      it('should replace localhost with 0.0.0.0', () => {
        const input = "app.listen(3000, 'localhost');";
        const output = applyPortReplacements(input);
        expect(output).toBe("app.listen(process.env.PORT || 3000, '0.0.0.0');");
      });

      it('should replace 127.0.0.1 with 0.0.0.0', () => {
        const input = "server.listen(8080, '127.0.0.1');";
        const output = applyPortReplacements(input);
        expect(output).toBe("server.listen(process.env.PORT || 8080, '0.0.0.0');");
      });

      it('should replace localhost with double quotes', () => {
        const input = 'app.listen(3000, "localhost");';
        const output = applyPortReplacements(input);
        expect(output).toBe("app.listen(process.env.PORT || 3000, '0.0.0.0');");
      });
    });

    describe('listen() with PORT variable and localhost', () => {
      it('should replace PORT, localhost with PORT, 0.0.0.0', () => {
        const input = "server.listen(PORT, 'localhost');";
        const output = applyPortReplacements(input);
        expect(output).toBe("server.listen(PORT, '0.0.0.0');");
      });

      it('should replace port, 127.0.0.1 with port, 0.0.0.0', () => {
        const input = "app.listen(port, '127.0.0.1');";
        const output = applyPortReplacements(input);
        expect(output).toBe("app.listen(port, '0.0.0.0');");
      });
    });

    describe('listen() with callback', () => {
      it('should handle listen with arrow function callback', () => {
        const input = 'app.listen(3000, () => console.log("running"));';
        const output = applyPortReplacements(input);
        expect(output).toContain("process.env.PORT || 3000");
        expect(output).toContain("'0.0.0.0'");
      });

      it('should handle listen with function keyword callback', () => {
        const input = 'app.listen(3000, function() { console.log("running"); });';
        const output = applyPortReplacements(input);
        expect(output).toContain("process.env.PORT || 3000");
        expect(output).toContain("'0.0.0.0'");
      });
    });

    describe('already has process.env.PORT', () => {
      it('should not double-wrap existing process.env.PORT usage', () => {
        const input = 'const PORT = process.env.PORT || 3000;';
        const output = applyPortReplacements(input);
        // The pattern matching should not create process.env.PORT || process.env.PORT
        expect(output).not.toContain('process.env.PORT || process.env.PORT');
      });
    });

    describe('no listen pattern', () => {
      it('should return unchanged if no listen pattern found', () => {
        const input = 'console.log("hello");';
        const output = applyPortReplacements(input);
        expect(output).toBe(input);
      });

      it('should return unchanged for non-matching code', () => {
        const input = 'const server = createServer();';
        const output = applyPortReplacements(input);
        expect(output).toBe(input);
      });
    });

    describe('complex scenarios', () => {
      it('should handle multiline Express app', () => {
        const input = `
const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('Hello');
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
`.trim();
        const output = applyPortReplacements(input);
        expect(output).toContain('const PORT = process.env.PORT || 3000');
      });

      it('should handle Fastify app', () => {
        const input = "fastify.listen({ port: 3000 });";
        const output = applyPortReplacements(input);
        // This pattern won't match (object syntax), so unchanged
        expect(output).toBe(input);
      });

      it('should handle multiple listen calls', () => {
        const input = `
http.listen(3000);
https.listen(443);
`.trim();
        const output = applyPortReplacements(input);
        expect(output).toContain("http.listen(process.env.PORT || 3000, '0.0.0.0')");
        expect(output).toContain("https.listen(process.env.PORT || 443, '0.0.0.0')");
      });
    });
  });

  describe('injectPortHandling', () => {
    let mockDevSupervisor: any;

    beforeEach(() => {
      mockDevSupervisor = {
        exec: vi.fn(),
      };
    });

    describe('path validation (isValidEntryFile)', () => {
      it('should accept relative paths', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
          stdout: 'app.listen(3000);',
        });
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
        });

        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          'src/server.js'
        );

        // Should proceed to read file (not rejected at validation)
        expect(result.modified).toBe(true);
        expect(mockDevSupervisor.exec).toHaveBeenCalled();
      });

      it('should accept simple filename', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
          stdout: 'app.listen(3000);',
        });
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
        });

        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          'index.js'
        );

        expect(result.modified).toBe(true);
        expect(mockDevSupervisor.exec).toHaveBeenCalled();
      });

      it('should reject absolute paths', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject parent directory traversal', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '../etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject deep parent directory traversal', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '../../secrets'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject normalized traversal (./../../)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          './../../etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject null byte injection', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          'server.js\0/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject URL-encoded traversal (%2e%2e)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '%2e%2e/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject URL-encoded traversal with uppercase (%2E%2E)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '%2E%2E/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject double-encoded traversal (%252e%252e)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '%252e%252e/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject mixed encoded traversal (.%2e/)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '.%2e/etc/passwd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject URL-encoded absolute path (%2fetc%2fpasswd)', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '%2fetc%2fpasswd'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should reject invalid URL encoding', async () => {
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '%ZZinvalid'
        );

        expect(result.modified).toBe(false);
        expect(result.skipped).toBe(false);
        expect(result.error).toContain('Invalid entry file path');
        expect(mockDevSupervisor.exec).not.toHaveBeenCalled();
      });

      it('should accept valid paths with percent in filename', async () => {
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
          stdout: 'app.listen(3000);',
        });
        mockDevSupervisor.exec.mockResolvedValueOnce({
          exit_code: 0,
        });

        // A file named "100%25complete.js" (URL-encoded % is %25)
        const result = await injectPortHandling(
          mockDevSupervisor,
          '/app',
          '100%25complete.js'
        );

        // This should be allowed - decodes to "100%complete.js" which is a valid filename
        expect(result.modified).toBe(true);
        expect(mockDevSupervisor.exec).toHaveBeenCalled();
      });
    });

    it('should return error when entry file not found', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 1,
        stderr: 'No such file or directory',
      });

      const result = await injectPortHandling(
        mockDevSupervisor,
        '/app',
        'src/server.ts'
      );

      expect(result.modified).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('Entry file not found');
    });

    it('should skip when process.env.PORT already present', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 0,
        stdout: 'const PORT = process.env.PORT || 3000;\napp.listen(PORT);',
      });

      const result = await injectPortHandling(
        mockDevSupervisor,
        '/app',
        'server.js'
      );

      expect(result.modified).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.reason).toContain('Already uses process.env.PORT');
    });

    it('should return error when no listen pattern found', async () => {
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 0,
        stdout: 'console.log("hello");',
      });

      const result = await injectPortHandling(
        mockDevSupervisor,
        '/app',
        'index.js'
      );

      expect(result.modified).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('Could not find listen() pattern');
    });

    it('should successfully modify entry file', async () => {
      // Mock read
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 0,
        stdout: 'app.listen(3000);',
      });

      // Mock write
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 0,
      });

      const result = await injectPortHandling(
        mockDevSupervisor,
        '/app',
        'server.js'
      );

      expect(result.modified).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.error).toBeUndefined();

      // Verify write was called with modified content
      expect(mockDevSupervisor.exec).toHaveBeenCalledTimes(2);
      const writeCall = mockDevSupervisor.exec.mock.calls[1][0];
      expect(writeCall.command).toContain("process.env.PORT || 3000");
      expect(writeCall.command).toContain("0.0.0.0");
    });

    it('should return error when write fails', async () => {
      // Mock read
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 0,
        stdout: 'app.listen(3000);',
      });

      // Mock write failure
      mockDevSupervisor.exec.mockResolvedValueOnce({
        exit_code: 1,
        stderr: 'Permission denied',
      });

      const result = await injectPortHandling(
        mockDevSupervisor,
        '/app',
        'server.js'
      );

      expect(result.modified).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('Failed to write modified file');
    });
  });
});
