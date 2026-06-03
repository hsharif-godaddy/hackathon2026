import { useCallback } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { summarizeScan } from '@/lib/security-scan';
import { type TestPilotRunResult } from '@/lib/testpilot';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

type CodeResult = TestPilotRunResult | { error: string; status: 'failed' };

function isErrorResult(r: CodeResult): r is { error: string; status: 'failed' } {
  return 'error' in r;
}

export function useTriggerSecurityAnalysis() {
  const setSecurityAnalysisRunning = useDevelopPageStore((s) => s.setSecurityAnalysisRunning);
  const acquireSecurityAnalysisLock = useDevelopPageStore((s) => s.acquireSecurityAnalysisLock);

  const triggerAnalysis = useCallback((appId: string, url?: string): void => {
    if (!acquireSecurityAnalysisLock(appId)) {
      logger.info('security-analysis.trigger.skipped', { appId, reason: 'already-running' });
      return;
    }

    fetch('/api/testpilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, url, runTests: ['code'] }),
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data: { code?: CodeResult } = await res.json();
        const codeResult = data?.code;

        if (!codeResult) {
          logger.warn('security-analysis.trigger.scan-failed', { appId, error: 'no result' });
        } else if (isErrorResult(codeResult)) {
          logger.warn('security-analysis.trigger.scan-failed', { appId, error: codeResult.error });
        } else if (codeResult.timedOut) {
          logger.warn('security-analysis.trigger.timed-out', { appId, taskId: codeResult.taskId });
        } else {
          const summary = summarizeScan(codeResult, appId);
          shipAnalyticsLog('security.scan_completed', summary);
          logger.info('security-analysis.trigger.completed', summary);
        }

        setSecurityAnalysisRunning(appId, false);
      })
      .catch((error: unknown) => {
        if (error instanceof SyntaxError) {
          logger.warn('security-analysis.trigger.invalid-response', {
            appId,
            error: error.message,
          });
        } else {
          logger.warn('security-analysis.trigger.failed', {
            appId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        setSecurityAnalysisRunning(appId, false);
      });
  }, [setSecurityAnalysisRunning, acquireSecurityAnalysisLock]);

  return { triggerAnalysis };
}
