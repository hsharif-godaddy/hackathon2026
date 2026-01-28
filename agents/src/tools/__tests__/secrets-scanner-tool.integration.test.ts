import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  createForApp: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class AppRepository {
    findById(appId: string) {
      return mocks.findById(appId);
    }
  },
}));

vi.mock('../../utils/dev-supervisor-client-factory.js', () => ({
  DevSupervisorClientFactory: {
    createForApp(appId: string) {
      return mocks.createForApp(appId);
    },
  },
}));

import { SecretsScannerTool } from '../secrets-scanner-tool.js';

describe('SecretsScannerTool integration', function integration() {
  it('parses gitleaks and semgrep output', async function parse() {
    const gitleaksOutput = JSON.stringify({
      findings: [
        {
          RuleID: 'generic-api-key',
          File: 'src/config.ts',
          StartLine: 10,
          StartColumn: 5,
          Secret: 'abcd1234secret',
          Description: 'Test secret',
        },
      ],
    });

    const semgrepOutput = JSON.stringify({
      results: [
        {
          check_id: 'hardcoded-secret',
          path: 'src/service.ts',
          start: { line: 42, col: 7 },
          message: 'Possible secret',
          metadata: { severity: 'warning' },
        },
      ],
    });

    mocks.findById.mockReturnValue({ id: 'app-123' });
    mocks.createForApp.mockReturnValue({ exec: mocks.exec });
    mocks.exec.mockImplementation(async function exec(args: { command: string }) {
      if (args.command === 'gitleaks version') {
        return { exit_code: 0, stdout: '8.18.0', stderr: '' };
      }
      if (args.command === 'git rev-parse HEAD') {
        return { exit_code: 0, stdout: 'abc123\n', stderr: '' };
      }
      if (args.command === 'gitleaks detect --source /app --report-format json --no-banner') {
        return { exit_code: 1, stdout: gitleaksOutput, stderr: '' };
      }
      if (args.command === 'semgrep --version') {
        return { exit_code: 0, stdout: '1.0.0', stderr: '' };
      }
      if (args.command === 'test -f .semgrep-secrets.yml && echo "exists" || echo "missing"') {
        return { exit_code: 0, stdout: 'exists', stderr: '' };
      }
      if (args.command === 'semgrep --config=.semgrep-secrets.yml --json --no-git-ignore') {
        return { exit_code: 1, stdout: semgrepOutput, stderr: '' };
      }

      throw new Error(`Unexpected command: ${args.command}`);
    });

    const tool = new SecretsScannerTool();
    const result = await tool.scan('app-123', { forceRescan: true });

    expect(result.success).toBe(true);
    expect(result.findings).toHaveLength(2);
    expect(result.summary.total).toBe(2);
    expect(result.summary.high).toBe(2);

    const gitleaksFinding = result.findings.find((finding) => finding.ruleId === 'generic-api-key');
    expect(gitleaksFinding).toBeDefined();
    expect(gitleaksFinding?.file).toBe('src/config.ts');
    expect(gitleaksFinding?.severity).toBe('high');
    expect(gitleaksFinding?.secret).toBe('abcd...');

    const semgrepFinding = result.findings.find((finding) => finding.ruleId === 'hardcoded-secret');
    expect(semgrepFinding).toBeDefined();
    expect(semgrepFinding?.file).toBe('src/service.ts');
    expect(semgrepFinding?.severity).toBe('high');
    expect(semgrepFinding?.secret).toBe('[REDACTED]');

    expect(result.formattedReport).toContain('Secrets Scan Results');
    expect(result.formattedReport).toContain('src/config.ts');
    expect(result.formattedReport).toContain('src/service.ts');
  });
});
