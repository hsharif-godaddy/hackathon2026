import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  createForApp: vi.fn(),
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp(appId: string) {
      return mocks.createForApp(appId);
    },
  },
}));

import { EslintSecurityScannerTool } from '../eslint-security-scanner-tool.js';

const APP_ID = 'app-eslint-test';

function setupExec(handler: (cmd: string) => { exit_code: number; stdout?: string; stderr?: string }) {
  mocks.createForApp.mockReturnValue({ exec: mocks.exec });
  mocks.exec.mockImplementation(async (args: { command: string }) => {
    return handler(args.command);
  });
}

describe('EslintSecurityScannerTool', () => {
  beforeEach(() => {
    mocks.exec.mockReset();
    mocks.createForApp.mockReset();
  });

  it('returns an error when both /app and /app-template are missing the config', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'missing\n', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.findings).toEqual([]);
    // Error mentions both paths and points the operator at the rebuild path.
    expect(result.error).toContain('Security ESLint config not found');
    expect(result.error).toContain('/app-template/eslint.security.config.js');
    expect(result.error).toContain('rebuild');
    expect(result.summary.total).toBe(0);
  });

  it('self-heals from /app-template when /app is missing the config', async () => {
    let appCheckCount = 0;
    let cpInvoked = false;

    setupExec((cmd) => {
      if (cmd.startsWith('test -f /app/eslint.security.config.js')) {
        appCheckCount += 1;
        // First check: missing (triggers self-heal).
        // Second check (post-cp verification): present.
        return {
          exit_code: 0,
          stdout: appCheckCount === 1 ? 'missing\n' : 'present\n',
          stderr: '',
        };
      }
      if (cmd.startsWith('test -f /app-template/eslint.security.config.js')) {
        return { exit_code: 0, stdout: 'present\n', stderr: '' };
      }
      if (cmd.startsWith('cp /app-template/eslint.security.config.js /app/')) {
        cpInvoked = true;
        return { exit_code: 0, stdout: '', stderr: '' };
      }
      if (cmd.includes('eslint')) {
        return { exit_code: 0, stdout: '[]', stderr: '' };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(cpInvoked).toBe(true);
    expect(appCheckCount).toBe(2); // missing → cp → verify → present
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns an error when self-heal cp fails', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f /app/eslint.security.config.js')) {
        return { exit_code: 0, stdout: 'missing\n', stderr: '' };
      }
      if (cmd.startsWith('test -f /app-template/eslint.security.config.js')) {
        return { exit_code: 0, stdout: 'present\n', stderr: '' };
      }
      if (cmd.startsWith('cp ')) {
        return { exit_code: 1, stdout: '', stderr: 'cp: read-only file system' };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Security ESLint config not found');
  });

  it('returns no findings on a clean scan (exit 0, empty array)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 0, stdout: '[]', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('parses ESLint findings into normalized SAST findings (exit 1)', async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: '/app/src/index.ts',
        messages: [
          {
            ruleId: 'security/detect-eval-with-expression',
            severity: 2,
            message: 'eval can be harmful.',
            line: 12,
            column: 7,
          },
          {
            ruleId: 'security/detect-unsafe-regex',
            severity: 1,
            message: 'Unsafe regex.',
            line: 30,
            column: 1,
          },
        ],
      },
    ]);

    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 1, stdout: eslintOutput, stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(2);

    const evalFinding = result.findings.find((f) => f.ruleId === 'security/detect-eval-with-expression');
    expect(evalFinding).toBeDefined();
    // High-impact rule list: eval is bumped to `high` regardless of ESLint severity.
    expect(evalFinding?.severity).toBe('high');
    expect(evalFinding?.line).toBe(12);

    const regexFinding = result.findings.find((f) => f.ruleId === 'security/detect-unsafe-regex');
    expect(regexFinding).toBeDefined();
    // ESLint warn (severity 1) → medium when not in the high-impact list.
    expect(regexFinding?.severity).toBe('medium');
  });

  it('drops non-security rule IDs even if ESLint emits them', async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: '/app/src/index.ts',
        messages: [
          {
            ruleId: 'no-unused-vars', // not a security rule — must be filtered
            severity: 2,
            message: 'unused',
            line: 1,
            column: 1,
          },
          {
            ruleId: 'no-unsanitized/property',
            severity: 2,
            message: 'innerHTML assignment',
            line: 5,
            column: 3,
          },
        ],
      },
    ]);

    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 1, stdout: eslintOutput, stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('no-unsanitized/property');
  });

  it('throws (records error) when ESLint produces non-JSON output', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 1, stdout: 'Cannot find module foo', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    // The tool catches the throw and returns success: false with error populated.
    expect(result.success).toBe(false);
    expect(result.error).toContain('unparseable output');
    expect(result.findings).toEqual([]);
  });

  it('throws on exit_code=1 with empty stdout (misconfiguration trap)', async () => {
    // ESLint says it found findings but emitted nothing readable. The previous
    // behavior (return []) would render the SAST tile as a clean run — exactly
    // the failure mode an attacker would prefer. Must throw + propagate as
    // scanner-unsuccessful through the orchestrator.
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 1, stdout: '', stderr: 'something is off' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('exited 1 (findings)');
    expect(result.error).toContain('stdout is empty');
    expect(result.findings).toEqual([]);
  });

  it('still returns clean on exit_code=0 with empty stdout (legitimate clean run)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 0, stdout: '', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns error on exit_code > 1 (real ESLint crash)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exit_code: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exit_code: 2, stdout: '', stderr: 'Out of memory' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ESLint failed');
  });
});
