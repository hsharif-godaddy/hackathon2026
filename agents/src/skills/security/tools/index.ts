import { z } from 'zod';
import type { SkillToolDefinition } from '@airo/ai-skills';
import type { AgentsAppContext } from '../../../types/agents-app-context.js';
import { AppRepository } from '../../../database/index.js';
import { Logger } from '../../../logging/index.js';
import {
  VulnerabilityScannerTool,
  type VulnerabilityScannerResult,
} from '../../../tools/vulnerability-scanner-tool.js';
import { appendSecurityReport } from '../../../tools/security-report-persistence.js';

const logger = Logger.create({ component: 'security-skill' });

interface SecurityVerificationFinding {
  kind: 'sca' | 'sast' | 'secret' | 'supplyChain';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  file?: string;
}

interface SecurityVerificationResult {
  scannedAt: string;
  success: boolean;
  error?: string;
  totalFindings: number;
  incompleteScanners: string[];
  bySeverity: { critical: number; high: number; medium: number; low: number };
  byKind: { sca: number; sast: number; secret: number; supplyChain: number };
  findings: SecurityVerificationFinding[];
}

function projectResult(result: VulnerabilityScannerResult): SecurityVerificationResult {
  const scannedAt: string = new Date().toISOString();

  if (!result.success) {
    return {
      scannedAt,
      success: false,
      error: result.error ?? 'Security scan failed',
      totalFindings: 0,
      incompleteScanners: ['sca', 'sast', 'secret', 'supplyChain'],
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byKind: { sca: 0, sast: 0, secret: 0, supplyChain: 0 },
      findings: [],
    };
  }

  const incompleteScanners: string[] = [];
  const findings: SecurityVerificationFinding[] = [];

  if (result.npmAudit) {
    for (const vuln of result.npmAudit.vulnerabilities) {
      findings.push({ kind: 'sca', severity: vuln.severity, title: vuln.title ?? vuln.name });
    }
  } else {
    incompleteScanners.push('sca');
  }

  if (result.codeQualityScan) {
    for (const finding of result.codeQualityScan.findings) {
      findings.push({ kind: 'sast', severity: finding.severity, title: finding.title, file: finding.file });
    }
  } else {
    incompleteScanners.push('sast');
  }

  if (result.secretsScan) {
    for (const finding of result.secretsScan.findings) {
      findings.push({ kind: 'secret', severity: finding.severity, title: finding.description, file: finding.file });
    }
  } else {
    incompleteScanners.push('secret');
  }

  if (result.supplyChainScan) {
    for (const finding of result.supplyChainScan.findings) {
      findings.push({ kind: 'supplyChain', severity: finding.severity, title: finding.title, file: finding.file });
    }
  } else {
    incompleteScanners.push('supplyChain');
  }

  const bySeverity: { critical: number; high: number; medium: number; low: number } = { critical: 0, high: 0, medium: 0, low: 0 };
  const byKind: { sca: number; sast: number; secret: number; supplyChain: number } = { sca: 0, sast: 0, secret: 0, supplyChain: 0 };
  for (const f of findings) {
    bySeverity[f.severity]++;
    byKind[f.kind]++;
  }

  return {
    scannedAt,
    success: true,
    totalFindings: findings.length,
    incompleteScanners,
    bySeverity,
    byKind,
    findings,
  };
}

export const runSecurityVerificationTool: SkillToolDefinition = {
  name: 'runSecurityVerification',
  config: { timeout: 300_000 },
  description:
    'Run a full security scan to verify whether previously reported security issues have been resolved. ' +
    'Always call this as the final step after completing any security fix work — it updates the Security tab ' +
    'with fresh results and returns a summary of remaining issues.',

  parameters: z.object({}),

  async execute(_input: Record<string, never>, context?: unknown): Promise<SecurityVerificationResult> {
    const agentContext = context as AgentsAppContext;
    const appId = agentContext?.metadata?.appId as string;
    if (!appId) {
      throw new Error('App ID is required for security verification');
    }

    logger.info('security-skill.runSecurityVerification.start', { appId });

    const scanner = new VulnerabilityScannerTool();
    let result: VulnerabilityScannerResult;
    try {
      result = await scanner.scan(appId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('security-skill.runSecurityVerification.scan.failed', { appId, error: message });
      throw new Error(`Security scan failed: ${message}`);
    }

    const appRepo = new AppRepository();
    const app = appRepo.findById(appId);
    if (app) {
      await appendSecurityReport(app.path, result).catch((err: unknown) => {
        logger.warn('security-skill.runSecurityVerification.report.save.failure', {
          appId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const projected: SecurityVerificationResult = projectResult(result);

    logger.info('security-skill.runSecurityVerification.complete', {
      appId,
      success: projected.success,
      totalFindings: projected.totalFindings,
      incompleteScanners: projected.incompleteScanners,
      bySeverity: projected.bySeverity,
    });

    return projected;
  },
};
