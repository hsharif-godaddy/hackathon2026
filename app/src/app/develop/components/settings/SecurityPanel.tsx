import { useState } from 'react';
import BigCard from "@/components/layout/BigCard";
import Button from "@ux/button";
import Box from "@ux/box";
import WandIcon from "@ux/icon/wand";
import Spinner from "@ux/spinner";
import { useAppIdFromParams } from '../utils';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import SecurityResults from './components/security/SecurityResults';

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
  // TODO: Define proper type for results based on TestPilot API response
  const [results, setResults] = useState<Record<string, any>>(null);
  const [error, setError] = useState<string | null>(null);

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
      setResults(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
    } finally {
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
            {isLoading ? 'Running Analysis...' : 'Run Analysis'}
          </Button>
        }>
        <Box>
          {error && (
            <div className="text-red-600 mb-4">
              <p className="font-medium">Error:</p>
              <p>{error}</p>
            </div>
          )}

          {isLoading && (
            <div className="flex flex-col items-center justify-center py-8">
              <Spinner size="lg" />
              <p className="mt-4 text-gray-600">Running security analysis...</p>
              <p className="mt-2 text-sm text-gray-500">This may take a few moments</p>
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
