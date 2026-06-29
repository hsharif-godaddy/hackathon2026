import { AGENT_ID_PREFIX } from '@/lib/format-agent-id';

export type FeedbackRevealMilestone =
  | 'logoDownload'
  | 'logoDownstreamApply'
  | 'websitePublish'
  | 'websiteDomainConnect'
  | 'domainPurchase'
  | 'domainDownstreamConnect'
  | 'imageSelection'
  | 'firstFileEdit';

/**
 * Milestones that currently gate agent-work task-completion feedback banners.
 * Active JTBD tracks:
 * - Logo: logoDownload, logoDownstreamApply
 * - Website: websitePublish, websiteDomainConnect
 * - Domain: domainPurchase, domainDownstreamConnect
 */
export const ACTIVE_FEEDBACK_REVEAL_MILESTONES: readonly FeedbackRevealMilestone[] = [
  'logoDownload',
  'logoDownstreamApply',
  'websitePublish',
  'websiteDomainConnect',
  'domainPurchase',
  'domainDownstreamConnect',
];

export interface FeedbackRevealSignals {
  logoDownload: boolean;
  logoDownstreamApply: boolean;
  websitePublish: boolean;
  websiteDomainConnect: boolean;
  domainPurchase: boolean;
  domainDownstreamConnect: boolean;
  /** Reserved — wire `markFeedbackRevealMilestone(appId, 'imageSelection')` when ready. */
  imageSelection: boolean;
  /** Gates first-build survey only — intentionally excluded from ACTIVE_FEEDBACK_REVEAL_MILESTONES. */
  firstFileEdit: boolean;
}

export type JtbdFeedbackTargetId = 'logo' | 'website' | 'domain';

export function jtbdTargetIdFromMilestone(
  milestone: FeedbackRevealMilestone | string | null | undefined
): JtbdFeedbackTargetId | null {
  if (milestone === 'logoDownload' || milestone === 'logoDownstreamApply') return 'logo';
  if (milestone === 'websitePublish' || milestone === 'websiteDomainConnect') return 'website';
  if (milestone === 'domainPurchase' || milestone === 'domainDownstreamConnect') return 'domain';
  return null;
}

/**
 * Namespaced `targetId` for invocation (task-completion) feedback: the JTBD
 * track carried under the `airo-app-builder-*` agent namespace —
 * `airo-app-builder-logo` | `airo-app-builder-website` | `airo-app-builder-domain`.
 *
 * Keeps the emitted `targetId` homogeneous with the rest of the skill-invoke
 * flow (the `agentTargetId` fallback is also `airo-app-builder-*`), so
 * downstream invocation-feedback consumers that key on the `airo-app-builder-`
 * prefix keep matching while gaining the JTBD track. Returns null when the
 * milestone doesn't map to a JTBD track.
 */
export function jtbdFeedbackTargetIdFromMilestone(
  milestone: FeedbackRevealMilestone | string | null | undefined
): string | null {
  const target: JtbdFeedbackTargetId | null = jtbdTargetIdFromMilestone(milestone);
  return target ? `${AGENT_ID_PREFIX}${target}` : null;
}

export function isFeedbackRevealReady(signals: FeedbackRevealSignals): boolean {
  for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
    if (signals[milestone]) return true;
  }
  return false;
}

/**
 * Next active milestone that is satisfied but not yet shown for agent-work feedback.
 */
export function resolvePendingFeedbackRevealMilestone(
  signals: FeedbackRevealSignals,
  shownMilestones: ReadonlySet<FeedbackRevealMilestone>
): FeedbackRevealMilestone | null {
  for (const milestone of ACTIVE_FEEDBACK_REVEAL_MILESTONES) {
    if (signals[milestone] && !shownMilestones.has(milestone)) {
      return milestone;
    }
  }
  return null;
}
