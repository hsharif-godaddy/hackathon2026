/**
 * Server-side switchboard flag utilities
 *
 * Provides functions to check feature flags from server-side code.
 */

import { logger } from '@/lib/request-context';
import { getRootDomainFromHeaders } from '@/utils/getRootDomain';

const BFF_HOST_PREFIX = 'bff.pcx';
const SWITCHBOARD_APP = 'airo-app-builder';

/**
 * Server-side local development feature flag overrides.
 * Applied when NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true.
 */
const SERVER_LOCAL_FEATURE_OVERRIDES: Record<string, boolean> = {
  'appbuilder-publish-button': true,
  'appbuilder-manage-plan': true,
  'appbuilder-settings-team': true,
  'appbuilder-domain-purchase': true,
  'appbuilder-domain-attach': true,
  'appbuilder-share-links': true,
  'appbuilder-transfer-ownership': true,
  'appbuilder-github-integration': true,
  'app-builder-budget-service': false, // opt-in: requires running Budget Service
  'appbuilder-assessment-agent': true,
  'appbuilder-assessment-override': true,
  'appbuilder-model-selector': true,
  'appbuilder-agent-profile-selector': true,
};

/**
 * Server-side local development string value overrides.
 * Applied when NEXT_PUBLIC_ENABLE_LOCAL_FEATURES=true.
 */
const SERVER_LOCAL_VALUE_OVERRIDES: Record<string, string> = {
  'appbuilder-model-override': 'default',
  'appbuilder-agent-profile': 'experimental',
};

/**
 * Fetch a raw feature flag value from Switchboard.
 * Shared implementation for both boolean and string flag lookups.
 */
async function fetchSwitchboardSetting<T>(
  featureName: string,
  jwt: string,
  headers: Headers,
  fallback: T,
): Promise<T> {
  const rootDomain = getRootDomainFromHeaders(headers);

  if (!rootDomain) {
    logger.warn('switchboard.server.no-root-domain', {
      featureName,
      message: 'Cannot check feature: no root domain',
    });
    return fallback;
  }

  const url = `https://${BFF_HOST_PREFIX}.${rootDomain}/api/config/feature/${featureName}?app=${SWITCHBOARD_APP}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `sso-jwt ${jwt}`,
      },
    });

    if (!response.ok) {
      logger.warn('switchboard.server.fetch-failure', {
        featureName,
        status: response.status,
        url,
      });
      return fallback;
    }

    const data = await response.json();
    return data?.setting ?? fallback;
  } catch (error) {
    logger.error('switchboard.server.fetch-error', {
      featureName,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

/**
 * Fetch a string-valued feature flag from the server
 *
 * Unlike checkSwitchboardFlag (boolean), this returns the raw string value
 * or null if unavailable. Used for flags that carry data (e.g., model names).
 *
 * @param featureName - Name of the feature flag
 * @param jwt - JWT token for authentication
 * @param headers - Request headers to extract root domain
 * @returns Promise resolving to string value or null
 */
export async function checkSwitchboardValue(
  featureName: string,
  jwt: string,
  headers: Headers
): Promise<string | null> {
  if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES === 'true') {
    if (featureName in SERVER_LOCAL_VALUE_OVERRIDES) {
      logger.info('switchboard.server.local-override', {
        featureName,
        value: SERVER_LOCAL_VALUE_OVERRIDES[featureName],
      });
      return SERVER_LOCAL_VALUE_OVERRIDES[featureName];
    }
  }

  return fetchSwitchboardSetting(featureName, jwt, headers, null);
}

/**
 * Check if a feature flag is enabled on the server
 *
 * @param featureName - Name of the feature flag (e.g., 'appbuilder-manage-plan')
 * @param jwt - JWT token for authentication
 * @param headers - Request headers to extract root domain
 * @returns Promise resolving to boolean indicating if flag is enabled
 */
export async function checkSwitchboardFlag(
  featureName: string,
  jwt: string,
  headers: Headers
): Promise<boolean> {
  if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES === 'true') {
    if (featureName in SERVER_LOCAL_FEATURE_OVERRIDES) {
      logger.info('switchboard.server.local-override', {
        featureName,
        value: SERVER_LOCAL_FEATURE_OVERRIDES[featureName],
      });
      return SERVER_LOCAL_FEATURE_OVERRIDES[featureName];
    }
  }

  return fetchSwitchboardSetting(featureName, jwt, headers, false);
}
