import type { FeedbackRevealMilestone } from '@/lib/initial-build-reveal';

const STORAGE_KEY_PREFIX = 'appbuilder-agent-work-feedback-shown:';

export function agentWorkFeedbackStorageKey(
  agentKey: string,
  appId: string,
  milestone: FeedbackRevealMilestone
): string {
  return `${agentKey}-${appId}-${milestone}`;
}

function storageKey(dedupeKey: string): string {
  return `${STORAGE_KEY_PREFIX}${dedupeKey}`;
}

export function hasShownAgentWorkFeedback(dedupeKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey(dedupeKey)) === 'true';
  } catch {
    return false;
  }
}

export function markAgentWorkFeedbackShown(dedupeKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(dedupeKey), 'true');
  } catch {
    // localStorage can throw in private browsing / quota-exceeded.
  }
}
