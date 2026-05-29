import { useCallback } from 'react';

import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

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
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        setSecurityAnalysisRunning(appId, false);
      })
      .catch((error: unknown) => {
        logger.warn('security-analysis.trigger.failed', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
        setSecurityAnalysisRunning(appId, false);
      });
  }, [setSecurityAnalysisRunning, acquireSecurityAnalysisLock]);

  return { triggerAnalysis };
}
