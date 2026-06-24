'use client';

import { useCallback, useState } from 'react';

import { useTranslations } from '@/hooks/useTranslations';

const PERMANENT_DISMISS_THRESHOLD = 2;

function getDismissCountStorageKey(appId: string): string {
  return `airo:github-sync-force-push-banner-dismiss-count:${appId}`;
}

function readDismissCount(appId: string): number {
  if (typeof window === 'undefined') return 0;

  const raw = window.localStorage.getItem(getDismissCountStorageKey(appId));
  const parsed = Number.parseInt(raw ?? '0', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

interface GitHubSyncForcePushInfo {
  message: string;
  showBanner: boolean;
  showInfoIcon: boolean;
  dismissBanner: () => void;
}

export function useGitHubSyncForcePushInfo(appId: string): GitHubSyncForcePushInfo {
  const t = useTranslations();
  const [dismissCount, setDismissCount] = useState(() => readDismissCount(appId));
  const [sessionDismissed, setSessionDismissed] = useState(false);

  const message = t(
    'builder_settings_github_force_push_warning',
    undefined,
    'Your GitHub code will be overwritten each time Airo syncs with your repository',
  );

  const showBanner = dismissCount < PERMANENT_DISMISS_THRESHOLD && !sessionDismissed;
  const showInfoIcon = dismissCount >= PERMANENT_DISMISS_THRESHOLD;

  const dismissBanner = useCallback(function dismissBanner() {
    const nextCount = readDismissCount(appId) + 1;
    try {
      window.localStorage.setItem(getDismissCountStorageKey(appId), String(nextCount));
    } catch {
      // Private browsing or quota exceeded — persist in-memory only
    }
    setDismissCount(nextCount);
    setSessionDismissed(true);
  }, [appId]);

  return {
    message,
    showBanner,
    showInfoIcon,
    dismissBanner,
  };
}
