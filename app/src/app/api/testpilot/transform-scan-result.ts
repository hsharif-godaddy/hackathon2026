/**
 * Vulnerability Scanner Result Transformation Utilities
 *
 * Transforms VulnerabilityScannerResult from agents service into
 * SecurityTestResult format expected by the SecurityResults UI component.
 */

import {
  extractRecommendations,
  extractSecretFindingsArray,
  extractVulnerabilitiesArray,
  VulnerabilityScannerResult,
} from '@/types/vulnerability-scanner';

/**
 * Security test result format expected by SecurityResults component
 */
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
      vulnerabilities: Array<{
        severity: string;
        title: string;
        description: string;
        impact: string;
        remediation: string[];
        location: string;
      }>;
      recommendations: string[];
    };
  };
  errors: string[];
}

/**
 * Transform VulnerabilityScannerResult to SecurityTestResult format
 *
 * Converts the agents service vulnerability scan result into the format
 * expected by the SecurityResults UI component.
 *
 * Performance: Uses Map-based lookups (O(n+m)) instead of nested finds (O(n*m))
 * for matching vulnerabilities to their remediation recommendations.
 *
 * @param scanResult - Raw scan result from agents service
 * @returns Transformed result in SecurityTestResult format
 */
export function transformVulnerabilityScanResult(
  scanResult: VulnerabilityScannerResult
): SecurityTestResult {
  // Extract arrays safely using type guards
  const vulnerabilities = extractVulnerabilitiesArray(scanResult);
  const secretFindings = extractSecretFindingsArray(scanResult);
  const recommendations = extractRecommendations(scanResult);

  // Build package-to-recommendation lookup map (O(m) operation)
  const autoFixMap = new Map(
    recommendations.autoFixable.map(rec => [rec.package, rec])
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
          // Transform npm audit vulnerabilities (O(n) with O(1) lookups)
          ...vulnerabilities.map((vuln) => {
            const autoFixRec = autoFixMap.get(vuln.name); // O(1) lookup

            return {
              severity: vuln.severity,
              title: vuln.title || vuln.name,
              description: vuln.description || 'Dependency vulnerability detected',
              impact: `Vulnerable package: ${vuln.name}`,
              remediation: autoFixRec?.description
                ? [autoFixRec.description]
                : ['Run npm audit fix to resolve this vulnerability'],
              location: vuln.name,
            };
          }),
          // Transform secrets scan findings
          ...secretFindings.map((finding) => ({
            severity: finding.severity,
            title: `${finding.ruleId}: Hard-coded secret detected`,
            description: finding.description,
            impact: `Secret exposed in ${finding.file}:${finding.line}`,
            remediation: [finding.remediation],
            location: `${finding.file}:${finding.line}:${finding.column}`,
          })),
        ],
        recommendations: [
          ...recommendations.autoFixable.map((rec) =>
            `Auto-fixable (${rec.severity}): ${rec.package} - ${rec.description}`
          ),
          ...recommendations.manualReview.map((rec) =>
            `Manual review (${rec.severity}): ${rec.package} - ${rec.suggestedAction}`
          ),
          ...recommendations.deprecatedReplacements.map((rec) =>
            `Deprecated: ${rec.package} - ${rec.reason}`
          ),
        ],
      },
    },
    errors: scanResult.success ? [] : [scanResult.error || 'Security scan failed'],
  };
}
