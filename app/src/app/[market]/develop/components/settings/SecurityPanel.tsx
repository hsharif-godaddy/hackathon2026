import { useEffect, useRef, useState } from 'react';
import Alert from '@ux/alert';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import WandIcon from "@ux/icon/wand";
import text from '@ux/text';

import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import SettingsSection from "@/app/[market]/develop/components/settings/SettingsSection";
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils';
import { type StructuredVulnerability } from '@/app/api/testpilot/transform-scan-result';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { type TestPilotRunResult } from "@/lib/testpilot";
import { useSecurityQuickFixHandoffStore } from '@/stores/useSecurityQuickFixHandoffStore';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { formatDate } from '@/utils/common';
import SecurityResults from './components/security/SecurityResults';

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
function summarizeScan(result: TestPilotRunResult, appId: string) {
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

/**
 * Security Panel component for running security analysis
 *
 * Provides interface to run security tests using the TestPilot API
 * and display the results to the user.
 */
export default function SecurityPanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const getServerState = useServerPollingStore((state) => state.getServerState);
  const serverState = getServerState(appId);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingStoredReport, setIsLoadingStoredReport] = useState(false);
  const [isQuickFixInProgress, setIsQuickFixInProgress] = useState(false);
  const [results, setResults] = useState<{ security?: TestPilotRunResult } | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);

  const handoffCompleteNonce = useSecurityQuickFixHandoffStore((s) => s.handoffCompleteNonce);
  const lastPanelResetNonce = useSecurityQuickFixHandoffStore((s) => s.lastPanelResetNonce);
  const recordPanelReset = useSecurityQuickFixHandoffStore((s) => s.recordPanelReset);

  const storedReportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (handoffCompleteNonce > lastPanelResetNonce) {
      storedReportAbortRef.current?.abort();
      setIsLoadingStoredReport(false);
      setResults(null);
      setLastScannedAt(null);
      setError(null);
      setErrorTitle(null);
      recordPanelReset();
    }
  }, [handoffCompleteNonce, lastPanelResetNonce, recordPanelReset]);

  useEffect(() => {
    if (!appId) return;
    const controller = new AbortController();
    storedReportAbortRef.current = controller;
    setIsLoadingStoredReport(true);
    fetch(`/api/security-report/${appId}`, { signal: controller.signal })
      .then(async (res) => {
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          setIsLoadingStoredReport(false);
          return;
        }
        if (!res.ok) {
          setIsLoadingStoredReport(false);
          return;
        }
        const data = await res.json() as { scannedAt: string; results: TestPilotRunResult['results']; timedOut: boolean; taskId: string };
        if (controller.signal.aborted) return;
        setResults({ security: { results: data.results, timedOut: data.timedOut, taskId: data.taskId } });
        setLastScannedAt(data.scannedAt);
        setIsLoadingStoredReport(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Stored report is optional — silently skip on error
        setIsLoadingStoredReport(false);
      });
    return () => controller.abort();
  }, [appId]);

  /**
   * Retry a timed out task by polling its results
   *
   * @param taskId - The task ID to retry
   * @param currentRetryCount - Current retry attempt number
   */
  const retryTimedOutTask = async (taskId: string, currentRetryCount: number) => {
    try {
      const response = await fetch(`/api/testpilot/${taskId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('builder_settings_security_error_attempt_failed'));
      }

      const data = await response.json();
      if (data.timedOut && currentRetryCount + 1 < 3) {
        // Still timed out, retry again
        setTimeout(() => {
          retryTimedOutTask(taskId, currentRetryCount + 1);
        }, 2000); // Wait 2 seconds before next retry
      } else {
        setResults({ security: data });
        if (!data.timedOut) {
          shipAnalyticsLog('security.scan_completed', summarizeScan(data, appId));
        }
        setIsLoading(false);
      }
    } catch (err) {
      // On retry error, try again unless we've hit max attempts
      if (currentRetryCount + 1 < 3) {
        setTimeout(() => {
          retryTimedOutTask(taskId, currentRetryCount + 1);
        }, 2000);
      } else {
        const errorMessage = err instanceof Error ? err.message : t('builder_settings_security_error_unknown');
        setError(errorMessage);
        setErrorTitle(t('builder_settings_security_error_attempt_failed_title'));
        setIsLoading(false);
      }
    }
  };

  /**
   * Handle running security analysis
   *
   * Calls the TestPilot API with 'security' test type to analyze
   * the current application for security vulnerabilities.
   */
  const handleRunAnalysis = async () => {
    if (!appId || !serverState?.url) {
      setError(t('builder_settings_security_error_not_ready'));
      return;
    }

    setIsLoading(true);
    setLastScannedAt(null);
    setError(null);
    setErrorTitle(null);

    try {
      const response = await fetch('/api/testpilot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appId,
          url: serverState.url,
          runTests: ['code'] // Use local vulnerability + secrets scanner tools
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('builder_settings_security_error_analysis_failed'));
      }

      const data = await response.json();
      const codeResult = data?.code;
      if (!codeResult) {
        setError(t('builder_settings_security_error_analysis_failed'));
        setIsLoading(false);
      } else if (codeResult.error || codeResult.status === 'failed') {
        setError(codeResult.error || t('builder_settings_security_error_analysis_failed'));
        setIsLoading(false);
      } else if (codeResult.timedOut) {
        if (codeResult.taskId) {
          // Start retry process
          retryTimedOutTask(codeResult.taskId, 0);
        } else {
          setError(t('builder_settings_security_error_analysis_failed'));
          setIsLoading(false);
        }
      } else {
        // Success - rename 'code' to 'security' for backwards compatibility with SecurityResults
        setResults({ security: codeResult });
        setLastScannedAt(new Date().toISOString());
        shipAnalyticsLog('security.scan_completed', summarizeScan(codeResult, appId));
        setIsLoading(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('builder_settings_security_error_unknown');
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const isReady = serverState?.isReady && serverState?.url;

  return (
    <Box gap="lg" className="@container">
      <SettingsSection
        title={t('builder_settings_security_title')}
        description={t('builder_settings_security_desc')}
        button={
          !isLoading && !isLoadingStoredReport && (
            <Button
              design="primary"
              size="sm"
              icon={<WandIcon />}
              disabled={!isReady || isLoading || isQuickFixInProgress || isLoadingStoredReport}
              onClick={handleRunAnalysis}
              text={t('builder_settings_security_analysis_run')}
            />
          )
        }
        hideStatus={true}
      >

        {isLoadingStoredReport && !isLoading && (
          <Card>
            <SettingsLoadingState />
          </Card>
        )}

        {!isLoadingStoredReport && !isReady && !error && !isLoading && !results && (
          <Card>
            <SettingsLoadingState
              title={t('builder_settings_security_waiting')}
            />
          </Card>
        )}

        {isLoading && (
          <Card>
            <SettingsLoadingState
              title={t('builder_settings_security_loading_running')}
              description={t('builder_common_loading_description')}
            />
          </Card>
        )}

        {results && !isLoading && (
          <>
            {!isReady && !isLoadingStoredReport && (
              <Card>
                <SettingsLoadingState
                  title={t('builder_settings_security_waiting')}
                />
              </Card>
            )}
            <SecurityResults
              results={results}
              onQuickFixInProgressChange={setIsQuickFixInProgress}
            />
            {lastScannedAt && (
              <text.p emphasis="passive" size={-1} className="mt-2">
                {t('builder_settings_security_last_analyzed')}: {formatDate(lastScannedAt, true)}
              </text.p>
            )}
          </>
        )}

        {error && (
          <Alert
            emphasis="critical"
            title={errorTitle}
          >
            {error}
          </Alert>
        )}
      </SettingsSection>
    </Box>
  );
}
