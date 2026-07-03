import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  findById: vi.fn(),
  appendSecurityReport: vi.fn(),
}));

vi.mock('../../../../tools/vulnerability-scanner-tool.js', () => ({
  VulnerabilityScannerTool: vi.fn(function VulnerabilityScannerToolMock() {
    return { scan: mocks.scan };
  }),
}));

vi.mock('../../../../tools/security-report-persistence.js', () => ({
  appendSecurityReport: mocks.appendSecurityReport,
}));

vi.mock('../../../../database/index.js', () => ({
  AppRepository: vi.fn(function AppRepositoryMock() {
    return { findById: mocks.findById };
  }),
}));

vi.mock('../../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

import { runSecurityVerificationTool } from '../index.js';

const APP_ID = 'test-app-id';
const APP_PATH = '/apps/test-app-id';

const makeContext = (appId?: string): { metadata: Record<string, unknown> } => ({
  metadata: appId ? { appId } : {},
});

const FULL_SCAN_RESULT = {
  success: true,
  executionTime: 2000,
  recommendations: { autoFixable: [], manualReview: [], deprecatedReplacements: [] },
  formattedReport: '',
  npmAudit: {
    summary: { total: 2, critical: 1, high: 1, medium: 0, low: 0 },
    vulnerabilities: [
      { id: 'vuln-1', name: 'lodash', severity: 'critical' as const, via: ['prototype-pollution'], title: 'Prototype Pollution' },
      { id: 'vuln-2', name: 'express', severity: 'high' as const, via: ['CVE-2024-1234'] },
    ],
  },
  codeQualityScan: {
    summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0 },
    findings: [
      { file: 'app/route.js', line: 10, column: 5, ruleId: 'security/detect-eval-with-expression', severity: 'high' as const, title: 'Eval with expression', description: 'Use of eval' },
    ],
  },
  secretsScan: {
    summary: { total: 1, critical: 1, high: 0, medium: 0, low: 0 },
    findings: [
      { file: '.env', line: 1, column: 1, ruleId: 'generic-api-key', severity: 'critical' as const, secret: 'sk-12...', description: 'Generic API key detected', remediation: 'Remove and rotate' },
    ],
    formattedReport: '',
  },
  supplyChainScan: {
    summary: { total: 1, critical: 0, high: 0, medium: 1, low: 0 },
    findings: [
      { ruleId: 'unknown-registry', severity: 'medium' as const, title: 'Unknown registry', description: 'Package from unknown registry', file: 'package-lock.json' },
    ],
  },
};

describe('security skill — runSecurityVerificationTool', () => {
  beforeEach(() => {
    mocks.scan.mockReset();
    mocks.findById.mockReset();
    mocks.appendSecurityReport.mockReset();
    mocks.appendSecurityReport.mockResolvedValue(undefined);
  });

  describe('result projection', () => {
    it('correctly projects findings from all scanner categories', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(result.success).toBe(true);
      expect(result.totalFindings).toBe(5);
      expect(result.byKind).toEqual({ sca: 2, sast: 1, secret: 1, supplyChain: 1 });
      expect(result.bySeverity).toEqual({ critical: 2, high: 2, medium: 1, low: 0 });
      expect(result.incompleteScanners).toEqual([]);
    });

    it('maps sca findings with title fallback to package name', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      const scaFindings = result.findings.filter((f) => f.kind === 'sca');
      expect(scaFindings).toHaveLength(2);
      expect(scaFindings[0].title).toBe('Prototype Pollution');
      expect(scaFindings[1].title).toBe('express');
    });

    it('maps secret findings using description as title', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      const secretFinding = result.findings.find((f) => f.kind === 'secret');
      expect(secretFinding?.title).toBe('Generic API key detected');
      expect(secretFinding?.file).toBe('.env');
    });

    it('lists all four scanners as incomplete when success:true but all scanner results are undefined', async () => {
      mocks.scan.mockResolvedValue({
        success: true,
        executionTime: 500,
        recommendations: { autoFixable: [], manualReview: [], deprecatedReplacements: [] },
        formattedReport: '',
      });
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(result.success).toBe(true);
      expect(result.totalFindings).toBe(0);
      expect(result.incompleteScanners).toEqual(['sca', 'sast', 'secret', 'supplyChain']);
    });

    it('lists only failed scanners as incomplete when some succeed', async () => {
      mocks.scan.mockResolvedValue({
        ...FULL_SCAN_RESULT,
        codeQualityScan: undefined,
        secretsScan: undefined,
      });
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(result.success).toBe(true);
      expect(result.totalFindings).toBe(3);
      expect(result.incompleteScanners).toEqual(['sast', 'secret']);
    });

    it('returns success:false with all scanners incomplete when scan fails at top level', async () => {
      mocks.scan.mockResolvedValue({
        success: false,
        executionTime: 30000,
        error: 'Scan timed out after 30s',
        recommendations: { autoFixable: [], manualReview: [], deprecatedReplacements: [] },
        formattedReport: '',
      });
      mocks.findById.mockReturnValue({ path: APP_PATH });

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(result.success).toBe(false);
      expect(result.error).toBe('Scan timed out after 30s');
      expect(result.totalFindings).toBe(0);
      expect(result.incompleteScanners).toEqual(['sca', 'sast', 'secret', 'supplyChain']);
    });
  });

  describe('persistence', () => {
    it('calls appendSecurityReport when app is found', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue({ path: APP_PATH });

      await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(mocks.appendSecurityReport).toHaveBeenCalledWith(APP_PATH, FULL_SCAN_RESULT);
    });

    it('skips appendSecurityReport when app is not found in DB', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue(null);

      const result = await runSecurityVerificationTool.execute({}, makeContext(APP_ID));

      expect(mocks.appendSecurityReport).not.toHaveBeenCalled();
      expect(result.totalFindings).toBe(5);
    });

    it('does not throw when appendSecurityReport rejects', async () => {
      mocks.scan.mockResolvedValue(FULL_SCAN_RESULT);
      mocks.findById.mockReturnValue({ path: APP_PATH });
      mocks.appendSecurityReport.mockRejectedValue(new Error('Disk full'));

      await expect(
        runSecurityVerificationTool.execute({}, makeContext(APP_ID)),
      ).resolves.toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws when appId is missing from context', async () => {
      await expect(
        runSecurityVerificationTool.execute({}, makeContext()),
      ).rejects.toThrow('App ID is required for security verification');
    });

    it('throws with descriptive message when scanner throws', async () => {
      mocks.scan.mockRejectedValue(new Error('Container unreachable'));

      await expect(
        runSecurityVerificationTool.execute({}, makeContext(APP_ID)),
      ).rejects.toThrow('Security scan failed: Container unreachable');
    });
  });
});
