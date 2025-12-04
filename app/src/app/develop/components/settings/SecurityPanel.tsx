import { useState } from 'react';
import BigCard from "@/components/layout/BigCard";
import Button from "@ux/button";
import Box from "@ux/box";
import WandIcon from "@ux/icon/wand";
import Spinner from "@ux/spinner";
import { useAppIdFromParams } from '../utils';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import SecurityResults from './components/security/SecurityResults';
import { type TestPilotRunResult } from "@/lib/testpilot";
import { logger } from '@/lib/request-context';

/**
 * Security Panel component for running security analysis
 *
 * Provides interface to run security tests using the TestPilot API
 * and display the results to the user.
 */
export default function SecurityPanel() {
  const appId = useAppIdFromParams();
  const getServerState = useServerPollingStore((state) => state.getServerState);
  const serverState = getServerState(appId);

  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<{ security?: TestPilotRunResult } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(errorData.error || 'Attempt failed');
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
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred during retry';
        setError(`Attempt failed: ${errorMessage}`);
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
      setError('Application not ready for analysis');
      return;
    }

    setIsLoading(true);
    setError(null);

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
        throw new Error(errorData.error || 'Security analysis failed');
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
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const isReady = serverState?.isReady && serverState?.url;

  return (
    <Box gap="lg" className="@container">
      <BigCard
        title="Security Analysis"
        description="Comprehensive security analysis of site vulnerabilities and code quality"
        button={
          <Button
            design="primary"
            icon={<WandIcon />}
            disabled={!isReady || isLoading}
            onClick={handleRunAnalysis}
          >
            {isLoading
              ? 'Running Analysis...'
              : 'Run Analysis'}
          </Button>
        }>
        <Box>
          {error && (
            <div className="text-red-600 mb-2">
              <p className="font-medium">Error:</p>
              <p>{error}</p>
            </div>
          )}

          {(isLoading) && (
            <div className="flex flex-col items-center justify-center py-4">
              <Spinner size="lg" />
              <p className="mt-2 text-gray-600">
                Running security analysis...
              </p>
              <p className="mt-1 text-sm text-gray-500">
                This may take a few moments
              </p>
            </div>
          )}

          {!isReady && !error && !isLoading && (
            <p className="text-gray-500">
              Waiting for application to be ready...
            </p>
          )}

          {results && !isLoading ? (
            <SecurityResults results={results} />
          ) : !error && !isLoading && isReady && (
            <p>
              No results yet. Click &ldquo;Run Analysis&rdquo; to start security scan.
            </p>
          )}
        </Box>
      </BigCard>
    </Box>
  );
}
