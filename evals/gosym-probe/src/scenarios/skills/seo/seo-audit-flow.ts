import { createSeoScenario } from './create-seo-scenario.js';
import type { IGocodeClient }
  from '../../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../../types.js';
import { MARKETING_HANDOFF } from '../../types.js';

/**
 * BASELINE (pre-deprecation): captures CURRENT behavior — an initial "run an SEO
 * audit" request is routed to the standalone marketing agent (handoff to
 * 'marketing'), which runs the global seoAnalysis tool and stops on the report
 * widget without editing code. Verified ground truth: the develop agent's SEO
 * prompt and the seo skill both instruct a handoff to marketing for the
 * check/audit turn (seoAnalysis is registered only on the marketing agent); the
 * develop-side seo__audit tool is reserved for the POST-handoff fix turn, so it
 * is out of scope for this initial-check scenario. GREEN against the marketing
 * agent on main today; flips to a no-handoff assertion once SEO migrates onto
 * develop.
 *
 * Construct validity:
 * - False positive: guarded by asserting seoAnalysis (a marketing-only tool, so
 *   it can only run after the handoff) AND the marketing handoff itself.
 * - False negative: seoAnalysis assumes the trial reaches the audit turn; the
 *   stop-after-report behavior is the "does not edit code" goal.
 * - Missing coverage: the post-handoff FIX turn (develop loads the seo skill and
 *   runs seo__audit) is a separate flow, intentionally not asserted here.
 */
export function seoAuditFlowScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSeoScenario(
    {
      name: 'seo-audit-flow',
      staticFirstMessage:
        'Can you run an SEO audit on my site and tell me what needs fixing?',
      goals: [
        {
          description: 'Agent calls seoAnalysis to generate the audit report',
          assertion: 'positive',
        },
        {
          description: 'Agent stops after the audit report and does NOT immediately edit code in the same turn',
          assertion: 'positive',
        },
        {
          description: 'Agent presents findings and waits for user to request fixes',
          assertion: 'positive',
        },
        {
          description:
            'The request is routed to the standalone marketing agent (handoff to marketing) to run the SEO analysis',
          assertion: 'positive',
        },
      ],
      expectedTools: [
        { tool: 'seoAnalysis', called: true },
        MARKETING_HANDOFF,
      ],
    },
    gocode,
    ctrlPlane,
  );
}
