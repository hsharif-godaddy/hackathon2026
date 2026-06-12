import type { StructuredVulnerability } from '@/app/api/security-analysis/transform-scan-result';
import type { SecurityAnalysisRunResult } from '@/lib/security-analysis';

type SeverityBucket = { critical: number; high: number; medium: number; low: number };
type Kind = StructuredVulnerability['kind'];
type ByKindCounts = Record<Kind, SeverityBucket>;

function emptyBucket(): SeverityBucket {
  return { critical: 0, high: 0, medium: 0, low: 0 };
}

/**
 * Build the analytics payload for a completed scan. Bucketed counts feed the
 * per-scanner-kind dashboard; top-level totals stay flat for simple queries.
 */
export function summarizeScan(result: SecurityAnalysisRunResult, appId: string) {
  const vulnerabilities: StructuredVulnerability[] =
    result.results?.aiInsights?.securityReport?.vulnerabilities ?? [];

  const byKind: ByKindCounts = {
    sca: emptyBucket(),
    secret: emptyBucket(),
    sast: emptyBucket(),
    supplyChain: emptyBucket(),
  };

  let criticalIssues = 0;
  let highIssues = 0;

  for (const v of vulnerabilities) {
    const sev = v.severity.toLowerCase();
    const bucket = sev === 'moderate' ? 'medium' : sev;
    if (bucket !== 'critical' && bucket !== 'high' && bucket !== 'medium' && bucket !== 'low') {
      continue;
    }
    byKind[v.kind][bucket]++;
    if (bucket === 'critical') criticalIssues++;
    else if (bucket === 'high') highIssues++;
  }

  const actionableIssues = criticalIssues + highIssues;

  return { appId, actionableIssues, criticalIssues, highIssues, byKind };
}
