/**
 * Client-side feature flag access.
 *
 * Flags are loaded server-side via `@godaddy/gasket-plugin-switchboard` and
 * serialized into gasket-data during render. Reads are synchronous - no
 * browser fetch, no per-user HTTP auth dependency. Flag flips propagate on
 * the next SSR render (~2 min cache refresh in the underlying client).
 */

import { isFeatureEnabled } from '@/lib/features';

const LOCAL_FEATURE_OVERRIDES: Record<string, boolean> = {
  'appbuilder-publish-button': true,
  'appbuilder-manage-plan': true,
  'appbuilder-settings-secrets': true,
  'appbuilder-settings-visualscan': true,
  'appbuilder-settings-team': true,
  'appbuilder-settings-marketing': true,
  'appbuilder-share-links': true,
  'app-builder-bypass-publish-limit': true,
  'appbuilder-social-video-generation': true,
  'app-builder-app-on-demand-reload': true,
  'appbuilder-domain-purchase': true,
  'appbuilder-domain-transfer': true,
  'appbuilder-transfer-ownership': true,
  'appbuilder-analytics': true,
  'appbuilder-settings-analytics': true,
  'appbuilder-suspended-compliance-banner': true,
  'appbuilder-suspended-nonpayment-banner': true,
  'appbuilder-github-integration': true,
  'appbuilder-unpublish': true,
  'app-builder-budget-service': false, // opt-in: requires running Budget Service
  'appbuilder-template-selector': true,
  'appbuilder-model-selector': true,
  'appbuilder-agent-profile-selector': true,
  'airo-builder-support-chat-ui': true,
  'airo-builder-chat-plans': true,
  'airo-builder-feedback-multistep': true,
  'appbuilder-post-publish-feature-selection': true,
  'airo-builder-theme-selection-chat': true,
  'appbuilder-brandbook': true,
};

/**
 * Read a boolean feature flag. Returns `undefined` during SSR or if the key
 * is not in the loaded tree. Pure function - no hooks - safe to call from
 * anywhere.
 */
export function getSwitchboardFlag(featureName: string): boolean | undefined {
  if (isFeatureEnabled.localFeatures() && featureName in LOCAL_FEATURE_OVERRIDES) {
    return LOCAL_FEATURE_OVERRIDES[featureName];
  }
  if (typeof window === 'undefined') return undefined;
  const value = window.gasketData?.switchboard?.[featureName];
  return typeof value === 'boolean' ? value : undefined;
}

/** Alias that satisfies the React hooks naming convention at component call sites. */
export const useSwitchboard = getSwitchboardFlag;
