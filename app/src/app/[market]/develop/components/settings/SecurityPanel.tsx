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
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { type SecurityAnalysisRunResult } from '@/lib/security-analysis';
import { summarizeScan } from '@/lib/security-scan';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSecurityQuickFixHandoffStore } from '@/stores/useSecurityQuickFixHandoffStore';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { formatDate } from '@/utils/common';
import { generateClickEID } from '@/utils/instrumentation';
import SecurityResults from './components/security/SecurityResults';

/**
 * Security Panel component for running security analysis
 *
 * Provides interface to run security analysis via the internal agents service
 * and display the results to the user.
 */
export default function SecurityPanel() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const getServerState = useServerPollingStore((state) => state.getServerState);
  const serverState = getServerState(appId);

  const [isLoadingStoredReport, setIsLoadingStoredReport] = useState(false);
  const [isQuickFixInProgress, setIsQuickFixInProgress] = useState(false);
  const [results, setResults] = useState<{ security?: SecurityAnalysisRunResult } | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);

  const setSecurityAnalysisRunning = useDevelopPageStore((s) => s.setSecurityAnalysisRunning);
  const acquireSecurityAnalysisLock = useDevelopPageStore((s) => s.acquireSecurityAnalysisLock);
  const isAnyAnalysisRunning = useDevelopPageStore((s) =>
    appId ? !!s.publishStates[appId]?.isSecurityAnalysisRunning : false
  );

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
        const data = await res.json() as { scannedAt: string; results: SecurityAnalysisRunResult['results']; timedOut: boolean; taskId: string };
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

  const handleRunAnalysis = async () => {
    if (!appId || !serverState?.url) {
      setError(t('builder_settings_security_error_not_ready'));
      return;
    }

    if (!acquireSecurityAnalysisLock(appId)) return;

    shipAnalyticsLog('security.run_analysis_clicked', { appId });
    setLastScannedAt(null);
    setError(null);
    setErrorTitle(null);

    try {
      const response = await fetch('/api/security-analysis', {
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
        setSecurityAnalysisRunning(appId, false);
      } else if (codeResult.error || codeResult.status === 'failed') {
        setError(codeResult.error || t('builder_settings_security_error_analysis_failed'));
        setSecurityAnalysisRunning(appId, false);
      } else {
        // Success - rename 'code' to 'security' for backwards compatibility with SecurityResults
        setResults({ security: codeResult });
        setLastScannedAt(new Date().toISOString());
        shipAnalyticsLog('security.scan_completed', summarizeScan(codeResult, appId));
        setSecurityAnalysisRunning(appId, false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('builder_settings_security_error_unknown');
      setError(errorMessage);
      setSecurityAnalysisRunning(appId, false);
    }
  };

  const isReady = serverState?.isReady && serverState?.url;

  return (
    <Box gap="lg" className="@container">
      <SettingsSection
        title={t('builder_settings_security_title')}
        description={t('builder_settings_security_desc')}
        button={
          !isAnyAnalysisRunning && !isLoadingStoredReport && (
            <Button
              design="primary"
              size="sm"
              icon={<WandIcon />}
              disabled={!isReady || isAnyAnalysisRunning || isQuickFixInProgress || isLoadingStoredReport}
              onClick={handleRunAnalysis}
              data-eid={generateClickEID('security.analysis_panel.run_analysis')}
              text={t('builder_settings_security_analysis_run')}
            />
          )
        }
        hideStatus={true}
      >

        {isLoadingStoredReport && !isAnyAnalysisRunning && (
          <Card>
            <SettingsLoadingState />
          </Card>
        )}

        {!isLoadingStoredReport && !isReady && !error && !isAnyAnalysisRunning && !results && (
          <Card>
            <SettingsLoadingState
              title={t('builder_settings_security_waiting')}
            />
          </Card>
        )}

        {isAnyAnalysisRunning && (
          <Card>
            <SettingsLoadingState
              title={t('builder_settings_security_loading_running')}
              description={t('builder_common_loading_description')}
            />
          </Card>
        )}

        {results && !isAnyAnalysisRunning && (
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
