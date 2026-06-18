import type { Scenario } from "./types.js";
import type { IGocodeClient } from "../clients/gocode-client.js";
import type { AABCtrlPlaneClient } from "../clients/aab-ctrl-plane-client.js";
import { beginnerPersona } from "../personas/beginner.js";
import { JTBDCompletionEvaluator } from "../evaluators/jtbd-completion.js";
import { BugHitRateEvaluator } from "../evaluators/bug-hit-rate.js";
import { TokenUsageEvaluator } from "../evaluators/token-usage.js";
import { TokenUsageCollector } from "../evaluators/token-usage-collector.js";
import { ToolFailureRateEvaluator } from "../evaluators/tool-failure-rate.js";

export function buildCookieConsentGtmScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  const collector = new TokenUsageCollector();
  return {
    name: "cookie-consent-gtm",
    suite: "analytics",
    persona: beginnerPersona,
    staticFirstMessage:
      "Add Google Tag Manager with container ID GTM-TEST123. Make sure it respects cookie consent and only loads after the user accepts cookies.",

    goals: [
      {
        description: "Agent generates code that imports from @/lib/analytics-consent",
        assertion: "positive",
      },
      {
        description: "Agent checks consent with getAnalyticsConsent() before loading GTM",
        assertion: "positive",
      },
      {
        description: "Agent subscribes to consent changes with onConsentChange()",
        assertion: "positive",
      },
      {
        description: "Agent uses GTM script (gtm.js) with GTM-* container ID, not gtag.js",
        assertion: "positive",
      },
      {
        description: "Agent initializes window.dataLayer before loading GTM script",
        assertion: "positive",
      },
      {
        description: "Agent does not load GTM script unconditionally (must be consent-gated)",
        assertion: "negative",
      },
    ],

    evaluators: [
      new JTBDCompletionEvaluator(gocode),
      new BugHitRateEvaluator(),
      new TokenUsageEvaluator({ collector, gocodeClient: gocode }),
      new ToolFailureRateEvaluator(),
    ],

    trials: 3,

    setup: async () => {
      const { appId, previewUrl } = await ctrlPlane.provisionApp({
        prompt: "Create a basic landing page",
        templateId: "simple-landing-page",
      });
      return { appId, previewUrl };
    },

    teardown: async (ctx) => {
      if (ctx?.appId) {
        await ctrlPlane.deleteApp(ctx.appId);
      }
    },
  };
}
