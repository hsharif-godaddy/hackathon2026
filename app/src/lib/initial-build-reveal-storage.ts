import type { FeedbackRevealMilestone } from '@/lib/initial-build-reveal';

const STORAGE_KEY_PREFIX = 'appbuilder-feedback-reveal:';

function storageKey(appId: string, milestone: FeedbackRevealMilestone): string {
  return `${STORAGE_KEY_PREFIX}${appId}:${milestone}`;
}

export function hasFeedbackRevealMilestone(
  appId: string,
  milestone: FeedbackRevealMilestone
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey(appId, milestone)) === 'true';
  } catch {
    return false;
  }
}

export function markFeedbackRevealMilestone(
  appId: string,
  milestone: FeedbackRevealMilestone
): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(appId, milestone), 'true');
    window.dispatchEvent(
      new CustomEvent('appbuilder:feedback-reveal-updated', {
        detail: { appId, milestone },
      })
    );
  } catch {
    // localStorage can throw in private browsing / quota-exceeded.
  }
}
