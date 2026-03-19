/**
 * Security Scan API Routes
 *
 * Provides endpoint for running security scans on app containers.
 * Executes npm audit and ESLint security checks via dev-supervisor.
 * 
 * TODO: Update security scans route to return JSON format similar to TestPilot vulnerabilities
 * 
 * The current route returns a mixed format with message strings and structured data.
 * It should be updated to return a JSON format similar to the TestPilot vulnerability results
 * for consistency with the SecurityResults component expectations.
 * 
 * Current format: { success, message, auditSummary, eslintSummary, vulnerabilities, rawData }
 * Target format: Should match TestPilot's SecurityTestResult interface structure
 * 
 * Reference:
 * - app/src/app/develop/components/settings/components/security/SecurityResults.tsx (lines 17-62)
 * - Current vulnerabilities array format (lines 219-228) is close but needs refinement
 * 
 */

import { Router, Request, Response, IRouter } from 'express';
import { z } from 'zod';
import { AppRepository } from '../../database/repositories/AppRepository.js';
import { DevSupervisorClientFactory } from '../../utils/dev-supervisor-client-factory.js';
import { logger } from '../../logging/index.js';
import { validateAppOwnershipFromBody } from '../middleware/app-ownership.js';

const securityScanSchema = z.object({
  appId: z.string(),
  production: z.boolean().optional().default(false),
});

/**
 * NPM Audit vulnerability data
 */
interface NpmAuditVulnerability {
  name?: string;
  severity?: string;
  via?: Array<string | { title?: string }>;
}

/**
 * NPM Audit output
 */
interface NpmAuditData {
  metadata?: {
    vulnerabilities?: {
      total?: number;
      critical?: number;
      high?: number;
      moderate?: number;
      low?: number;
    };
  };
  vulnerabilities?: Record<string, NpmAuditVulnerability>;
}

/**
 * ESLint message
 */
interface EslintMessage {
  ruleId?: string;
  severity?: number;
  message?: string;
  line?: number;
  column?: number;
}

/**
 * ESLint file result
 */
interface EslintFileResult {
  filePath: string;
  messages?: EslintMessage[];
}

const router: IRouter = Router();
const appRepo = new AppRepository();

router.post('/security-scan', validateAppOwnershipFromBody('appId'), async (req: Request, res: Response) => {
  try {
    const { appId, production } = securityScanSchema.parse(req.body);

    logger.info('security-scan.api.start', { appId, production });

    const app = await appRepo.findById(appId);
    if (!app) {
      return res.status(404).json({ error: `App '${appId}' not found` });
    }

    const devSupervisor = DevSupervisorClientFactory.createForApp(appId);
    if (!devSupervisor) {
      return res.status(503).json({ error: 'Dev-supervisor not available. Make sure the app container is running.' });
    }

    const auditCmd = production ? 'npm audit --json --production' : 'npm audit --json';
    const eslintCmd = 'npx eslint . --ext .js,.ts,.jsx,.tsx --format json --no-eslintrc --config .eslintrc.json';

    logger.info('security-scan.api.executing', { appId, auditCommand: auditCmd, eslintCommand: eslintCmd });

    // Execute both commands and capture stdout directly
    const [auditResult, eslintResult] = await Promise.all([
      devSupervisor.exec({ command: auditCmd, capture_output: true }),
      devSupervisor.exec({ command: eslintCmd, capture_output: true }),
    ]);

    let auditData: NpmAuditData | null = null;
    let eslintData: EslintFileResult[] | null = null;

    // Parse npm audit output from stdout
    if (auditResult.stdout) {
      try {
        const trimmedContent = auditResult.stdout.trim();

        if (!trimmedContent) {
          logger.warn('security-scan.api.audit-empty-output', { appId });
        } else if (trimmedContent.startsWith('{')) {
          auditData = JSON.parse(trimmedContent);
          logger.info('security-scan.api.audit-parsed', { appId, hasVulnerabilities: !!auditData?.vulnerabilities });
        } else {
          logger.warn('security-scan.api.audit-invalid-json', {
            appId,
            preview: trimmedContent.substring(0, 100),
          });
        }
      } catch (parseError) {
        logger.warn('security-scan.api.audit-parse-error', {
          appId,
          error: (parseError as Error).message,
        });
      }
    } else {
      logger.warn('security-scan.api.audit-no-output', { appId });
    }

    // Parse ESLint output from stdout
    if (eslintResult.stdout) {
      try {
        const trimmedContent = eslintResult.stdout.trim();

        if (!trimmedContent) {
          logger.warn('security-scan.api.eslint-empty-output', { appId });
        } else if (trimmedContent.startsWith('[')) {
          eslintData = JSON.parse(trimmedContent);
          logger.info('security-scan.api.eslint-parsed', { appId, filesScanned: eslintData?.length || 0 });
        } else {
          logger.warn('security-scan.api.eslint-invalid-json', {
            appId,
            preview: trimmedContent.substring(0, 100),
          });
        }
      } catch (parseError) {
        logger.warn('security-scan.api.eslint-parse-error', {
          appId,
          error: (parseError as Error).message,
        });
      }
    } else {
      logger.warn('security-scan.api.eslint-no-output', { appId });
    }

    const auditVulnMetadata = auditData?.metadata?.vulnerabilities || {};
    const auditSummary = {
      total: auditVulnMetadata.total || 0,
      critical: auditVulnMetadata.critical || 0,
      high: auditVulnMetadata.high || 0,
      medium: auditVulnMetadata.moderate || 0,
      low: auditVulnMetadata.low || 0,
    };

    const eslintSummary = {
      total: 0,
      error: 0,
      warning: 0,
      securityIssues: 0,
    };

    interface Vulnerability {
      id: string;
      type: 'npm' | 'eslint';
      severity: string;
      title: string;
      description: string;
      packageName?: string;
      via?: string[];
      file?: string;
      line?: number | undefined;
      ruleId?: string | undefined;
    }

    const vulnerabilities: Vulnerability[] = [];

    if (auditData?.vulnerabilities) {
      Object.entries(auditData.vulnerabilities).forEach(([pkgName, vuln]: [string, NpmAuditVulnerability]) => {
        let severity = vuln.severity || 'medium';
        if (severity === 'moderate') {severity = 'medium';}

        vulnerabilities.push({
          id: `npm-${pkgName}`,
          type: 'npm',
          severity,
          title: vuln.name || pkgName,
          description:
            vuln.via && Array.isArray(vuln.via)
              ? vuln.via.find((v): v is { title?: string } => typeof v === 'object')?.title || 'Vulnerability detected'
              : 'Vulnerability detected',
          packageName: pkgName,
          via: vuln.via && Array.isArray(vuln.via) ? vuln.via.filter((v): v is string => typeof v === 'string') : [],
        });
      });
    }

    if (eslintData && Array.isArray(eslintData)) {
      eslintData.forEach((file) => {
        if (file.messages && Array.isArray(file.messages)) {
          file.messages.forEach((msg) => {
            eslintSummary.total++;
            if (msg.severity === 2) {eslintSummary.error++;}
            if (msg.severity === 1) {eslintSummary.warning++;}

            const isSecurityRule = msg.ruleId && (msg.ruleId.startsWith('security/') || msg.ruleId.startsWith('security-node/'));
            if (isSecurityRule) {
              eslintSummary.securityIssues++;
            }

            let severity = 'low';
            if (msg.severity === 2) {
              severity = isSecurityRule ? 'high' : 'medium';
            } else if (msg.severity === 1) {
              severity = isSecurityRule ? 'medium' : 'low';
            }

            vulnerabilities.push({
              id: `eslint-${file.filePath}-${msg.line}-${msg.column}`,
              type: 'eslint',
              severity,
              title: msg.ruleId || 'ESLint Issue',
              description: msg.message || 'ESLint security issue detected',
              file: file.filePath.replace(app.path + '/', ''),
              line: msg.line,
              ruleId: msg.ruleId,
            });
          });
        }
      });
    }

    logger.info('security-scan.api.complete', { appId, auditSummary, eslintSummary });

    let message = '🔒 Security Scan Results:\n\n';

    message += '**NPM Audit:**\n';
    if (auditSummary.total === 0) {
      message += '✅ No dependency vulnerabilities found\n';
    } else {
      message += `Found ${auditSummary.total} vulnerabilit${auditSummary.total === 1 ? 'y' : 'ies'}:\n`;
      if (auditSummary.critical > 0) {message += `  🔴 Critical: ${auditSummary.critical}\n`;}
      if (auditSummary.high > 0) {message += `  🟠 High: ${auditSummary.high}\n`;}
      if (auditSummary.medium > 0) {message += `  🟡 Medium: ${auditSummary.medium}\n`;}
      if (auditSummary.low > 0) {message += `  🟢 Low: ${auditSummary.low}\n`;}
    }

    message += '\n**ESLint Security Analysis:**\n';
    if (eslintSummary.total === 0) {
      message += '✅ No code security issues found\n';
    } else {
      message += `Found ${eslintSummary.total} issue${eslintSummary.total === 1 ? '' : 's'}:\n`;
      if (eslintSummary.error > 0) {message += `  ❌ Errors: ${eslintSummary.error}\n`;}
      if (eslintSummary.warning > 0) {message += `  ⚠️  Warnings: ${eslintSummary.warning}\n`;}
      if (eslintSummary.securityIssues > 0) {message += `  🔒 Security-specific: ${eslintSummary.securityIssues}\n`;}
    }

    if (auditSummary.total > 0 || eslintSummary.total > 0) {
      message += '\n💡 Recommendations:\n';
      if (auditSummary.total > 0) {message += '  • Run `npm audit fix` to resolve dependency issues\n';}
      if (eslintSummary.total > 0) {message += '  • Review ESLint security findings\n';}
    }

    return res.json({
      success: true,
      message,
      auditSummary,
      eslintSummary,
      vulnerabilities,
      rawData: {
        npmAudit: auditData,
        eslint: eslintData,
      },
    });
  } catch (error) {
    logger.error('security-scan.api.error', {
      error: (error as Error).message,
      stack: (error as Error).stack,
    });

    return res.status(500).json({
      success: false,
      error: 'Security scan failed',
      details: (error as Error).message,
    });
  }
})

export default router;

