/**
 * Vulnerability Scanner Result Transformation Utilities
 *
 * Transforms VulnerabilityScannerResult from agents service into
 * SecurityTestResult format expected by the SecurityResults UI component.
 *
 * The transform emits *structured* data — kind discriminator + raw scanner
 * fields — so the client can build user-visible strings via the i18n layer.
 * No English template strings are produced here.
 */

import {
  extractRecommendations,
  extractSastFindingsArray,
  extractSecretFindingsArray,
  extractSupplyChainFindingsArray,
  extractVulnerabilitiesArray,
  VulnerabilityScannerResult,
} from '@/types/vulnerability-scanner';

export type VulnerabilityKind = 'sca' | 'secret' | 'sast' | 'supplyChain';

/**
 * Structured vulnerability emitted by the BFF transform. The client templates
 * user-visible strings (title / impact / remediation) via translation keys
 * keyed on `kind`. Scanner-supplied free-text (CVE titles, ESLint messages,
 * lockfile-lint messages) lives in `rawTitle` / `description` and is passed
 * through verbatim — translating those would require scanner-side i18n which
 * is out of scope today.
 */
export interface StructuredVulnerability {
  kind: VulnerabilityKind;
  severity: string;
  ruleId?: string;
  rawTitle?: string;
  description?: string;
  remediation?: string[];
  packageName?: string;
  file?: string;
  line?: number;
  column?: number;
}

/** Security test result format expected by SecurityResults component. */
export interface SecurityTestResult {
  status: 'pending' | 'completed' | 'failed';
  success: boolean;
  testsPassed: number;
  testsFailed: number;
  totalTests: number;
  passRate: number;
  details: unknown[];
  aiInsights: {
    securityReport: {
      vulnerabilities: StructuredVulnerability[];
    };
  };
  errors: string[];
}

/**
 * Transform VulnerabilityScannerResult to SecurityTestResult format.
 *
 * Each finding becomes a `StructuredVulnerability` with a `kind` discriminator
 * plus raw context — the client uses translation keys (builder_settings_security_*)
 * to format the user-visible strings.
 *
 * Performance: Uses Map-based lookups (O(n+m)) instead of nested finds (O(n*m))
 * for matching SCA vulnerabilities to their auto-fix recommendations.
 */
export function transformVulnerabilityScanResult(
  scanResult: VulnerabilityScannerResult
): SecurityTestResult {
  const vulnerabilities = extractVulnerabilitiesArray(scanResult);
  const secretFindings = extractSecretFindingsArray(scanResult);
  const sastFindings = extractSastFindingsArray(scanResult);
  const supplyChainFindings = extractSupplyChainFindingsArray(scanResult);
  const recommendations = extractRecommendations(scanResult);

  // Package → autoFix recommendation lookup so SCA findings can ship the
  // matching fix-command description as their remediation hint.
  const autoFixMap = new Map(
    recommendations.autoFixable.map((rec) => [rec.package, rec])
  );

  const scaVulnerabilities: StructuredVulnerability[] = vulnerabilities.map((vuln) => {
    const autoFixRec = autoFixMap.get(vuln.name);
    return {
      kind: 'sca',
      severity: vuln.severity,
      rawTitle: vuln.title || vuln.name,
      description: vuln.description,
      ...(autoFixRec?.description && { remediation: [autoFixRec.description] }),
      packageName: vuln.name,
    };
  });

  const secretVulnerabilities: StructuredVulnerability[] = secretFindings.map((finding) => ({
    kind: 'secret',
    severity: finding.severity,
    ruleId: finding.ruleId,
    description: finding.description,
    remediation: [finding.remediation],
    file: finding.file,
    line: finding.line,
    column: finding.column,
  }));

  const sastVulnerabilities: StructuredVulnerability[] = sastFindings.map((finding) => ({
    kind: 'sast',
    severity: finding.severity,
    ruleId: finding.ruleId,
    rawTitle: finding.title,
    description: finding.description,
    file: finding.file,
    line: finding.line,
    column: finding.column,
  }));

  const supplyChainVulnerabilities: StructuredVulnerability[] = supplyChainFindings.map(
    (finding) => ({
      kind: 'supplyChain',
      severity: finding.severity,
      ruleId: finding.ruleId,
      rawTitle: finding.title,
      description: finding.description,
      file: finding.file,
      ...(finding.packageName && { packageName: finding.packageName }),
    }),
  );

  return {
    status: scanResult.success ? 'completed' : 'failed',
    success: scanResult.success,
    testsPassed: 0,
    testsFailed: 0,
    totalTests: 0,
    passRate: 0,
    details: [],
    aiInsights: {
      securityReport: {
        vulnerabilities: [
          ...scaVulnerabilities,
          ...secretVulnerabilities,
          ...sastVulnerabilities,
          ...supplyChainVulnerabilities,
        ],
      },
    },
    errors: scanResult.success ? [] : [scanResult.error || 'Security scan failed'],
  };
}
