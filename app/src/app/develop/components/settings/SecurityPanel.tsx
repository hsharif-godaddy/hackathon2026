import { useState } from 'react';
import Alert from '@ux/alert';
import Box from "@ux/box";
import Button from "@ux/button";
import Card from "@ux/card";
import WandIcon from "@ux/icon/wand";

import { SettingsLoadingState } from '@/app/develop/components/settings/components/SettingsLoadingState';
import { useAppIdFromParams } from '@/app/develop/components/utils';
import BigCard from "@/components/layout/BigCard";
import { useTranslations } from '@/hooks/useTranslations';
import { type TestPilotRunResult } from "@/lib/testpilot";
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import SecurityResults from './components/security/SecurityResults';

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
  const [results, setResults] = useState<{ security?: TestPilotRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string | null>(null);

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
        // Success or error, but not timeout
        setResults({ security: data });
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
          runTests: ['security']
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || t('builder_settings_security_error_analysis_failed'));
      }

      const data = await response.json();
      if (data?.security?.timedOut) {
        // Start retry process
        retryTimedOutTask(data?.security?.taskId, 0);
      } else {
        // Success
        setResults(data);
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
      <BigCard
        title={t('builder_settings_security_title')}
        description={t('builder_settings_security_desc')}
        button={
          <Button
            design="primary"
            icon={<WandIcon />}
            disabled={!isReady || isLoading}
            onClick={handleRunAnalysis}
            text={isLoading ? t('builder_settings_security_analysis_running') : t('builder_settings_security_analysis_run')}
          />
        }
        hideStatus={true}>

        {!isReady && !error && !isLoading && (
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
          <SecurityResults results={results} />
        )}

        {error && (
          <Alert
            emphasis="critical"
            title={errorTitle}
          >
            {error}
          </Alert>
        )}
      </BigCard>
    </Box>
  );
}
