/**
 * Hook for managing security scan logic
 */

import { useCallback, useState } from 'react';

import { appFetch } from '@/lib/gasket-config';
import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import type { TestPilotRunResult } from '@/lib/testpilot';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSiteStore } from '@/stores/useSiteStore';
import type { SecurityScanResult } from '../types';

interface TestPilotVulnerability {
  severity: string;
  title: string;
  description?: string;
}

// Discriminated union for TestPilot API response
type TestPilotApiResponse =
  | { success: true; data: TestPilotRunResult }
  | { success: false; error: string; status?: string };

export function useSecurityScan(appId: string) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const { setSecurityScanResults, setGoLiveModalStep } = useDevelopPageStore();
  const getSite = useSiteStore((state) => state.getSite);

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
      const site = getSite(appId);
      const urlToScan = site?.published_url || site?.preview_url;

      if (!urlToScan) {
        logger.warn('go-live.security-scan.no-url', {
          appId,
          message: 'No published or preview URL available, skipping security scan'
        });

        skipSecurityScan();
        return;
      }

      // Check if URL is localhost or not publicly accessible
      const isLocalhost = urlToScan.includes('localhost') ||
                          urlToScan.includes('127.0.0.1') ||
                          urlToScan.includes('0.0.0.0');

      if (isLocalhost) {
        logger.warn('go-live.security-scan.localhost', {
          appId,
          url: urlToScan,
          message: 'Skipping security scan for localhost URL - TestPilot requires publicly accessible URL'
        });

        skipSecurityScan();
        return;
      }

      logger.info('go-live.security-scan.start', {
        appId,
        url: urlToScan,
        urlType: site?.published_url ? 'published' : 'preview'
      });

      const response = await appFetch('/api/testpilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          url: urlToScan,
          runTests: ['security']
        })
      });

      if (!response.ok) {
        throw new Error(`Security scan failed: ${response.statusText}`);
      }

      const data = await response.json();

      logger.info('go-live.security-scan.response', {
        appId,
        hasSecurityData: !!data.security,
        responseKeys: Object.keys(data)
      });

      if (!data.security) {
        throw new Error('Security scan returned no results. The scan may not have completed successfully.');
      }

      // Parse the response into our discriminated union
      const rawResult = data.security;
      const securityApiResponse: TestPilotApiResponse =
        rawResult.error || rawResult.status === 'failed'
          ? { success: false, error: rawResult.error || 'Security scan failed', status: rawResult.status }
          : { success: true, data: rawResult as TestPilotRunResult };

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
        critical: vulnerabilities.filter((v: TestPilotVulnerability) => v.severity.toLowerCase() === 'critical').length,
        high: vulnerabilities.filter((v: TestPilotVulnerability) => v.severity.toLowerCase() === 'high').length,
        moderate: vulnerabilities.filter((v: TestPilotVulnerability) =>
          v.severity.toLowerCase() === 'medium' || v.severity.toLowerCase() === 'moderate'
        ).length,
        low: vulnerabilities.filter((v: TestPilotVulnerability) => v.severity.toLowerCase() === 'low').length
      };

      const normalizedResults: SecurityScanResult = {
        vulnerabilities: vulnerabilities.map((v: TestPilotVulnerability) => {
          const severityLower = v.severity.toLowerCase();
          // Map "medium" to "moderate" to match our type system
          const normalizedSeverity = severityLower === 'medium' ? 'moderate' : severityLower;
          return {
            severity: normalizedSeverity as 'critical' | 'high' | 'moderate' | 'low',
            title: v.title,
            description: v.description
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

      if (totalIssues === 0) {
        setGoLiveModalStep(appId, 'video');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setScanError(errorMessage);
      logger.error('go-live.security-scan.failure', { appId, error: errorMessage });
    } finally {
      setIsScanning(false);
    }
  }, [appId, getSite, setSecurityScanResults, setGoLiveModalStep, skipSecurityScan]);

  return {
    isScanning,
    scanError,
    runScan,
    skipSecurityScan
  };
}
