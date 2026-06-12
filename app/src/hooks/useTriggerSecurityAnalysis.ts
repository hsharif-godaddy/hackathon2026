import { useCallback } from 'react';

import { shipAnalyticsLog } from '@/lib/logging';
import { logger } from '@/lib/request-context';
import { type SecurityAnalysisRunResult } from '@/lib/security-analysis';
import { summarizeScan } from '@/lib/security-scan';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

type CodeResult = SecurityAnalysisRunResult | { error: string; status: 'failed' };

function isErrorResult(r: CodeResult): r is { error: string; status: 'failed' } {
  return 'error' in r;
}

interface TriggerAnalysisOptions {
  onSafe?: () => void;
  onIssuesFound?: () => void;
}

export function useTriggerSecurityAnalysis() {
  const setSecurityAnalysisRunning = useDevelopPageStore((s) => s.setSecurityAnalysisRunning);
  const acquireSecurityAnalysisLock = useDevelopPageStore((s) => s.acquireSecurityAnalysisLock);

  const triggerAnalysis = useCallback((appId: string, url?: string, options?: TriggerAnalysisOptions): void => {
    if (!acquireSecurityAnalysisLock(appId)) {
      logger.info('security-analysis.trigger.skipped', { appId, reason: 'already-running' });
      return;
    }

    fetch('/api/security-analysis', {
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
        } else {
          const summary = summarizeScan(codeResult, appId);
          shipAnalyticsLog('security.scan_completed', summary);
          logger.info('security-analysis.trigger.completed', summary);
          if (summary.actionableIssues === 0) {
            options?.onSafe?.();
          } else {
            options?.onIssuesFound?.();
          }
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
