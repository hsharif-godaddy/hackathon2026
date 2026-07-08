'use client';

import { useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';

const POLL_INTERVAL_MS = 30_000;

interface CollaboratorAccessState {
  revoked: boolean;
}

/**
 * Polls the site endpoint every 30s to detect access revocation for
 * collaborators. Only active when the current app is a shared app
 * (`site.sharedWithMe === true`). When the endpoint returns 404,
 * the collaborator's access has been revoked by the owner.
 */
export function useCollaboratorAccessCheck(): CollaboratorAccessState {
  const [revoked, setRevoked] = useState<boolean>(false);
  const currentAppId: string | null = useDevelopPageStore((state) => state.currentAppId);
  const sharedWithMe: boolean = useDevelopPageStore(
    (state) => state.site?.sharedWithMe === true
  );
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sharedWithMe || !currentAppId || revoked) {
      return undefined;
    }

    const checkAccess = async (): Promise<void> => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const resp: Response = await fetch(
          `/api/sites?site_id=${encodeURIComponent(currentAppId)}`,
          { credentials: 'include', signal: controller.signal }
        );
        if (resp.status === 404 || resp.status === 403) {
          logger.info('collaborator.access.revoked', { appId: currentAppId });
          setRevoked(true);
        } else if (!resp.ok) {
          logger.warn('collaborator.access.check_unexpected_status', { appId: currentAppId, status: resp.status });
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          return;
        }
        logger.warn('collaborator.access.check_failed', {
          appId: currentAppId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    const timer: ReturnType<typeof setInterval> = setInterval(checkAccess, POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [sharedWithMe, currentAppId, revoked]);

  return { revoked };
}
