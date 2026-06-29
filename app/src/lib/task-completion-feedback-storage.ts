import type { FeedbackRevealMilestone } from '@/lib/initial-build-reveal';

const COOLDOWN_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOCAL_PREFIX = 'appbuilder-task-completion-feedback';
const SESSION_PREFIX = 'appbuilder-task-completion-feedback-session';

function jtbdFromMilestone(milestone: FeedbackRevealMilestone): string | null {
  // Keep mapping explicit so each JTBD milestone has independent cooldown/session state.
  if (milestone === 'logoDownload') return 'logo-download';
  if (milestone === 'logoDownstreamApply') return 'logo-downstream-apply';
  if (milestone === 'websitePublish') return 'website-publish';
  if (milestone === 'websiteDomainConnect') return 'website-domain-connect';
  if (milestone === 'domainPurchase') return 'domain-purchase';
  if (milestone === 'domainDownstreamConnect') return 'domain-downstream-connect';
  return null;
}

function localKey(appId: string, jtbd: string): string {
  return `${LOCAL_PREFIX}:${appId}:${jtbd}`;
}

function sessionKey(appId: string, jtbd: string): string {
  return `${SESSION_PREFIX}:${appId}:${jtbd}`;
}

export function hasCooldown(
  appId: string,
  milestone: FeedbackRevealMilestone,
  now: number = Date.now()
): boolean {
  const jtbd = jtbdFromMilestone(milestone);
  if (!jtbd || typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem(localKey(appId, jtbd));
    if (!stored) return false;
    const timestamp = Number(stored);
    if (Number.isNaN(timestamp)) return false;
    return now - timestamp < COOLDOWN_DAYS * MS_PER_DAY;
  } catch {
    return false;
  }
}

export function markCooldown(
  appId: string,
  milestone: FeedbackRevealMilestone,
  now: number = Date.now()
): void {
  const jtbd = jtbdFromMilestone(milestone);
  if (!jtbd || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(localKey(appId, jtbd), String(now));
  } catch {
    // Storage failures should never block feedback flow.
  }
}

export function hasShownInSession(
  appId: string,
  milestone: FeedbackRevealMilestone
): boolean {
  const jtbd = jtbdFromMilestone(milestone);
  if (!jtbd || typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(sessionKey(appId, jtbd)) === 'true';
  } catch {
    return false;
  }
}

export function markShownInSession(
  appId: string,
  milestone: FeedbackRevealMilestone
): void {
  const jtbd = jtbdFromMilestone(milestone);
  if (!jtbd || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(sessionKey(appId, jtbd), 'true');
  } catch {
    // Storage failures should never block feedback flow.
  }
}
