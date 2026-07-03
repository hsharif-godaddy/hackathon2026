import type { ExpectedArtifactSpec } from '../../types.js';
import type { CapturedSite } from '../../../clients/site-capture/types.js';
import { hasRenderedContent } from '../../matchers/rendered-content.js';
import { noModuleNotFoundItem } from '../../matchers/checklist-items.js';

/**
 * Expectation fixture for the pvs-contact-page-expectations pilot
 * scenario. Encodes the "expected finished product" as CheckList
 * behavioral items (Ribeiro et al., ACL 2020): capability (MFT) and
 * invariance (INV) items hard-gate (binary pass/fail). Directional (DIR)
 * signals live in `directionalItems` and are scored separately by the
 * score-mode DirectionalSignalEvaluator, never hard-gating the scenario.
 *
 * Matchers assert *capabilities* over the captured artifact — a
 * reachable route, rendered copy — never golden-output equality, so
 * any valid implementation passes. Tuned to be satisfiable by a real
 * landing-page build while still being able to fail meaningfully.
 */
/** Words that signal a contact mechanism in rendered copy or routes. */
const CONTACT_PATTERN = /contact|get in touch|email|reach us|message|inquir|inbox/i;

/**
 * Capability check for "a way for visitors to make contact". Tests the
 * CAPABILITY, not preview keywords: passes if any reachable route looks
 * like a contact page (path matches contact/about), OR any route's
 * rendered signals (title/h1/headings/body across ALL routes, not just
 * one truncated preview) reference contacting the business. Replaces a
 * narrow rendered-preview keyword scan that produced a systematic
 * static-vs-judge disagreement in graduation run c474b305 (the static
 * matcher missed contact capability the agent did build).
 */
function hasContactCapability(site: CapturedSite): boolean {
  const contactRoute = site.routes.some(
    (r) =>
      (r.status === 'ok' || r.status === 'redirect') &&
      /contact|about/i.test(r.path),
  );
  if (contactRoute) return true;
  return site.perRoute.some((rc) => {
    const r = rc.rendered;
    if (!r) return false;
    return CONTACT_PATTERN.test(
      `${r.title} ${r.h1 ?? ''} ${r.headingText} ${r.bodyPreview}`,
    );
  });
}

export const contactPageExpectation: ExpectedArtifactSpec = {
  intent:
    'Build a landing page for a small business with a hero section and '
    + 'a way for visitors to make contact.',
  // v4: mentions-contact moved from items into directionalItems (scored by the
  // score-mode DirectionalSignalEvaluator, no longer a binary item). v3:
  // has-rendered-content retuned from a rendered-signals-only scan to a
  // domMatcher that falls back to snapshot HTML — RenderedSignals came back
  // empty on fully-rendered pages (capture-timing artifact), causing false
  // fails. v2: mentions-contact moved keyword→capability. Bumped so baseline
  // comparison skips the changed items.
  evalVersion: 'v4',
  items: [
    {
      id: 'home-route-reachable',
      description: 'the home route renders successfully (HTTP ok)',
      type: 'capability',
      routeMatcher: { path: '/', mustBeReachable: true },
    },
    {
      id: 'has-rendered-content',
      description: 'the site renders non-trivial text content',
      type: 'capability',
      domMatcher: (site, snapshots) => hasRenderedContent(site, snapshots),
    },
    noModuleNotFoundItem,
  ],
  directionalItems: [
    {
      id: 'mentions-contact',
      description: 'the site provides a way to contact the business '
        + '(contact/about route or contact copy)',
      domMatcher: (site) => hasContactCapability(site),
    },
  ],
};
