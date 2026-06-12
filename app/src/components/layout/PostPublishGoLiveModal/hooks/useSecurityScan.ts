/**
 * Hook for managing security scan logic
 */

import { useCallback, useState } from 'react';

import { useTranslations } from '@/hooks/useTranslations';
import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import type { SecurityAnalysisRunResult } from '@/lib/security-analysis';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import type { SecurityScanResult } from '../types';

/**
 * Mirrors StructuredVulnerability shape from transform-scan-result.ts. Inlined
 * here to avoid a cross-module dep into BFF-internal types from a UI hook.
 */
interface SecurityAnalysisVulnerability {
  kind: 'sca' | 'secret' | 'sast' | 'supplyChain';
  severity: string;
  ruleId?: string;
  rawTitle?: string;
  description?: string;
  packageName?: string;
  file?: string;
  line?: number;
}

type T = ReturnType<typeof useTranslations>;

function vulnTitle(v: SecurityAnalysisVulnerability, t: T): string {
  switch (v.kind) {
    case 'sca':
      return t('builder_settings_security_vuln_title_sca', { title: v.rawTitle ?? v.packageName ?? '' });
    case 'secret':
      return t('builder_settings_security_vuln_title_secret', { ruleId: v.ruleId ?? '' });
    case 'sast':
      return t('builder_settings_security_vuln_title_sast', { ruleId: v.ruleId ?? '', title: v.rawTitle ?? '' });
    case 'supplyChain':
      return t('builder_settings_security_vuln_title_supply_chain', { ruleId: v.ruleId ?? '', title: v.rawTitle ?? '' });
  }
}

function vulnDescription(v: SecurityAnalysisVulnerability, t: T): string | undefined {
  if (v.description && v.description.trim().length > 0) return v.description;
  if (v.kind === 'sca') return t('builder_settings_security_vuln_desc_sca_fallback');
  return undefined;
}

type SecurityAnalysisApiResponse =
  | { success: true; data: SecurityAnalysisRunResult }
  | { success: false; error: string; status?: string };

export function useSecurityScan(appId: string) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const { setSecurityScanResults, setGoLiveModalStep } = useDevelopPageStore();
  const t = useTranslations();

  const skipSecurityScan = useCallback(() => {
    logger.info('go-live.security-scan.skipped', { appId });

    const mockResults: SecurityScanResult = {
      vulnerabilities: [],
      summary: { critical: 0, high: 0, moderate: 0, low: 0 }
    };

    setSecurityScanResults(appId, mockResults);
    setGoLiveModalStep(appId, 'video');
  }, [appId, setSecurityScanResults, setGoLiveModalStep]);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setScanError(null);

    try {
      logger.info('go-live.security-scan.start', {
        appId,
        message: 'Running internal vulnerability and secrets scan'
      });

      const response = await appFetch('/api/security-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          runTests: ['code']
        })
      });

      if (!response.ok) {
        throw new Error(`Security scan failed: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('go-live.security-scan.response', {
        appId,
        hasSecurityData: !!data.code,
        responseKeys: Object.keys(data)
      });

      if (!data.code) {
        throw new Error('Security scan returned no results. The scan may not have completed successfully.');
      }

      // Parse the response into our discriminated union
      const rawResult = data.code;
      const securityApiResponse: SecurityAnalysisApiResponse =
        rawResult.error || rawResult.status === 'failed'
          ? { success: false, error: rawResult.error || 'Security scan failed', status: rawResult.status }
          : { success: true, data: rawResult as SecurityAnalysisRunResult };

      // Handle error case (TypeScript type narrowing)
      if (securityApiResponse.success === false) {
        logger.error('go-live.security-scan.api-error', {
          appId,
          error: securityApiResponse.error
        });
        throw new Error(securityApiResponse.error);
      }

      // Now we know it's successful (TypeScript narrows the type)
      const securityRunResult = securityApiResponse.data;

      if (securityRunResult.timedOut) {
        throw new Error('Security scan timed out. Please try again.');
      }

      const securityData = securityRunResult.results;
      const vulnerabilities = securityData.aiInsights?.securityReport?.vulnerabilities || [];

      const summary = {
        critical: vulnerabilities.filter((v: SecurityAnalysisVulnerability) => v.severity.toLowerCase() === 'critical').length,
        high: vulnerabilities.filter((v: SecurityAnalysisVulnerability) => v.severity.toLowerCase() === 'high').length,
        moderate: vulnerabilities.filter((v: SecurityAnalysisVulnerability) =>
          v.severity.toLowerCase() === 'medium' || v.severity.toLowerCase() === 'moderate'
        ).length,
        low: vulnerabilities.filter((v: SecurityAnalysisVulnerability) => v.severity.toLowerCase() === 'low').length
      };

      const normalizedResults: SecurityScanResult = {
        vulnerabilities: vulnerabilities.map((v: SecurityAnalysisVulnerability) => {
          const severityLower = v.severity.toLowerCase();
          // Map "medium" to "moderate" to match our type system
          const normalizedSeverity = severityLower === 'medium' ? 'moderate' : severityLower;
          return {
            severity: normalizedSeverity as 'critical' | 'high' | 'moderate' | 'low',
            title: vulnTitle(v, t),
            description: vulnDescription(v, t),
          };
        }),
        summary
      };

      setSecurityScanResults(appId, normalizedResults);

      const totalIssues = summary.critical + summary.high + summary.moderate + summary.low;

      shipAnalyticsLog('go_live.security.scan_completed', {
        appId,
        totalIssues,
        criticalIssues: summary.critical,
        highIssues: summary.high
      });

      logger.info('go-live.security-scan.success', {
        appId,
        totalIssues,
        summary
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setScanError(errorMessage);
      logger.error('go-live.security-scan.failure', { appId, error: errorMessage });
    } finally {
      setIsScanning(false);
    }
  }, [appId, setSecurityScanResults, t]);

  return {
    isScanning,
    scanError,
    runScan,
    skipSecurityScan
  };
}
