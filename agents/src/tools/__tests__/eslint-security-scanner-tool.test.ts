import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  runCommandSync: vi.fn(),
  createForWorkspace: vi.fn(),
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace(workspaceId: string, variant: string) {
    return mocks.createForWorkspace(workspaceId, variant);
  },
}));

import { EslintSecurityScannerTool } from '../eslint-security-scanner-tool.js';

const APP_ID = 'app-eslint-test';

function setupExec(handler: (cmd: string) => { exitCode: number; stdout?: string; stderr?: string }) {
  mocks.createForWorkspace.mockReturnValue({ tasks: { runCommandSync: mocks.runCommandSync } });
  mocks.runCommandSync.mockImplementation(async function (args: { command: string }) {
    const res = handler(args.command);
    return { ...res, timedOut: false, taskId: 'mock', executionTimeMs: 0 };
  });
}

describe('EslintSecurityScannerTool', () => {
  beforeEach(() => {
    mocks.runCommandSync.mockReset();
    mocks.createForWorkspace.mockReset();
  });

  it('returns an error when both /app and /app-template are missing the config', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'missing\n', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(mocks.createForWorkspace).toHaveBeenCalledWith(APP_ID, 'preview');
    expect(result.success).toBe(false);
    expect(result.findings).toEqual([]);
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
        return {
          exitCode: 0,
          stdout: appCheckCount === 1 ? 'missing\n' : 'present\n',
          stderr: '',
        };
      }
      if (cmd.startsWith('test -f /app-template/eslint.security.config.js')) {
        return { exitCode: 0, stdout: 'present\n', stderr: '' };
      }
      if (cmd.startsWith('cp /app-template/eslint.security.config.js /app/')) {
        cpInvoked = true;
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      if (cmd.includes('eslint')) {
        return { exitCode: 0, stdout: '[]', stderr: '' };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(cpInvoked).toBe(true);
    expect(appCheckCount).toBe(2);
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns an error when self-heal cp fails', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f /app/eslint.security.config.js')) {
        return { exitCode: 0, stdout: 'missing\n', stderr: '' };
      }
      if (cmd.startsWith('test -f /app-template/eslint.security.config.js')) {
        return { exitCode: 0, stdout: 'present\n', stderr: '' };
      }
      if (cmd.startsWith('cp ')) {
        return { exitCode: 1, stdout: '', stderr: 'cp: read-only file system' };
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
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 0, stdout: '[]', stderr: '' };
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
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 1, stdout: eslintOutput, stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(2);

    const evalFinding = result.findings.find((f) => f.ruleId === 'security/detect-eval-with-expression');
    expect(evalFinding).toBeDefined();
    expect(evalFinding?.severity).toBe('high');
    expect(evalFinding?.line).toBe(12);

    const regexFinding = result.findings.find((f) => f.ruleId === 'security/detect-unsafe-regex');
    expect(regexFinding).toBeDefined();
    expect(regexFinding?.severity).toBe('medium');
  });

  it('drops non-security rule IDs even if ESLint emits them', async () => {
    const eslintOutput = JSON.stringify([
      {
        filePath: '/app/src/index.ts',
        messages: [
          {
            ruleId: 'no-unused-vars',
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
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 1, stdout: eslintOutput, stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('no-unsanitized/property');
  });

  it('throws (records error) when ESLint produces non-JSON output', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 1, stdout: 'Cannot find module foo', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('unparseable output');
    expect(result.findings).toEqual([]);
  });

  it('throws on exitCode=1 with empty stdout (misconfiguration trap)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 1, stdout: '', stderr: 'something is off' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('exited 1 (findings)');
    expect(result.error).toContain('stdout is empty');
    expect(result.findings).toEqual([]);
  });

  it('still returns clean on exitCode=0 with empty stdout (legitimate clean run)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 0, stdout: '', stderr: '' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('returns error on exitCode > 1 (real ESLint crash)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return { exitCode: 0, stdout: 'present\n', stderr: '' };
      if (cmd.includes('eslint')) return { exitCode: 2, stdout: '', stderr: 'Out of memory' };
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new EslintSecurityScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('ESLint failed');
  });
});
