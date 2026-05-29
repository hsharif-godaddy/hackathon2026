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

import { SupplyChainScannerTool } from '../supply-chain-scanner-tool.js';
import { makeRunCommandResult } from '../../workspace/__tests__/mock-helpers.js';

const APP_ID = 'app-supply-chain-test';

function setupExec(handler: (cmd: string) => ReturnType<typeof makeRunCommandResult>) {
  mocks.createForWorkspace.mockReturnValue({ tasks: { runCommandSync: mocks.runCommandSync } });
  mocks.runCommandSync.mockImplementation(async (args: { command: string }) => handler(args.command));
}

/** Convenience: the lockfile-lint command emits violations via stderr in v4. */
function lockfileLintRun(stderr: string, exitCode = 1): ReturnType<typeof makeRunCommandResult> {
  return makeRunCommandResult({ exitCode, stdout: '', stderr });
}

describe('SupplyChainScannerTool', () => {
  beforeEach(() => {
    mocks.runCommandSync.mockReset();
    mocks.createForWorkspace.mockReset();
  });

  it('returns not-applicable error when package-lock.json is missing', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'missing\n' });
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('package-lock.json not found');
    expect(result.findings).toEqual([]);
  });

  it('reports timeout error when lockfile existence check times out', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) {
        return makeRunCommandResult({ exitCode: -1, timedOut: true, executionTimeMs: 5_000 });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    // Must NOT report "package-lock.json not found" — that masks the real issue
    expect(result.error).not.toContain('not found');
  });

  it('returns clean on exit_code 0', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) return makeRunCommandResult();
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('parses each lockfile-lint validator message into the right rule + severity', async () => {
    const stderr = [
      'detected invalid host(s) for package: lodash@4.17.21',
      '    expected: registry.npmjs.org',
      '    actual:   evil.example.com',
      '',
      'detected invalid scheme(s) for package: react@18.0.0',
      '    expected: https:',
      '    actual:   http:',
      '',
      'detected invalid protocol for package: vue@3.0.0',
      '    expected: https:',
      '    actual:   http:',
      '',
      'detected invalid integrity hash for package: chalk@5.0.0',
      '    expected: SRI hash',
      '    actual:   missing',
      '',
      'detected resolved URL for package with a different name: foo@1.0.0',
      '    expected: foo',
      '    actual:   bar',
      '',
      'detected invalid url(s) for package: bar@1.0.0',
      '    expected: https://registry.npmjs.org/bar/-/bar-1.0.0.tgz',
      '    actual:   https://other.example.com/bar.tgz',
    ].join('\n');

    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) return lockfileLintRun(stderr);
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(6);

    const byRule = (id: string) => result.findings.find((f) => f.ruleId === id);

    expect(byRule('lockfile-lint/allowed-hosts')?.severity).toBe('critical');
    expect(byRule('lockfile-lint/allowed-hosts')?.packageName).toBe('lodash@4.17.21');

    expect(byRule('lockfile-lint/allowed-schemes')?.severity).toBe('high');
    expect(byRule('lockfile-lint/validate-https')?.severity).toBe('high');
    expect(byRule('lockfile-lint/validate-integrity')?.severity).toBe('medium');
    expect(byRule('lockfile-lint/validate-package-names')?.severity).toBe('high');
    expect(byRule('lockfile-lint/allowed-urls')?.severity).toBe('high');
  });

  it('passes --allowed-hosts npm github (space-separated) by default', async () => {
    let invokedCommand = '';
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) {
        invokedCommand = cmd;
        return makeRunCommandResult();
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    await tool.scan(APP_ID);

    // Space-separated is REQUIRED — lockfile-lint uses yargs `array: true`,
    // which interprets a comma-joined value as one literal hostname.
    expect(invokedCommand).toContain('--allowed-hosts npm github ');
  });

  it('accepts an array of hosts and joins them with spaces', async () => {
    let invokedCommand = '';
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) {
        invokedCommand = cmd;
        return makeRunCommandResult();
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    await tool.scan(APP_ID, { allowedHosts: ['npm', 'github', 'artifactory.internal'] });

    expect(invokedCommand).toContain('--allowed-hosts npm github artifactory.internal ');
  });

  it('back-compat: accepts a legacy comma-separated string and splits it', async () => {
    let invokedCommand = '';
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) {
        invokedCommand = cmd;
        return makeRunCommandResult();
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    await tool.scan(APP_ID, { allowedHosts: 'npm,github,artifactory.internal' });

    expect(invokedCommand).toContain('--allowed-hosts npm github artifactory.internal ');
  });

  it('uses FALLBACK_META (medium severity) for unknown validator messages', async () => {
    // Simulate a future lockfile-lint validator emitting a message phrasing
    // we don't recognize. The scanner must still emit a finding (severity
    // medium) rather than silently dropping it.
    const stderr = 'detected new fancy validation issue for package: unknown@1.0.0';

    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) return lockfileLintRun(stderr);
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.ruleId).toBe('lockfile-lint/other');
    expect(result.findings[0]?.severity).toBe('medium');
  });

  it('throws (parser-desync) when exit_code=1 but parser finds nothing', async () => {
    // exit_code 1 means lockfile-lint detected violations. If the parser
    // returns empty, the upstream message phrasing has drifted. This MUST
    // throw, not silently pass — otherwise supply chain reads as score 100.
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) {
        return makeRunCommandResult({ exitCode: 1, stderr: 'completely unrelated noise without "detected" lines' });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('upstream message format may have changed');
  });

  it('throws on real lockfile-lint failure (exit code > 1)', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) return makeRunCommandResult({ exitCode: 2, stderr: 'OOM' });
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('lockfile-lint failed');
  });

  it('reports timeout when lockfile-lint exceeds time limit', async () => {
    setupExec((cmd) => {
      if (cmd.startsWith('test -f')) return makeRunCommandResult({ stdout: 'present\n' });
      if (cmd.includes('lockfile-lint')) {
        return makeRunCommandResult({ exitCode: -1, timedOut: true, executionTimeMs: 30_000 });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const tool = new SupplyChainScannerTool();
    const result = await tool.scan(APP_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });
});
