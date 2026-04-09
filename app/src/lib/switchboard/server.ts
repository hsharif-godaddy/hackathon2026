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
  'appbuilder-higher-plans': true,
  'appbuilder-github-integration': true,
  'app-builder-budget-service': false, // opt-in: requires running Budget Service
  'appbuilder-assessment-agent': true,
  'appbuilder-assessment-override': true,
};

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
  // Local development override
  if (process.env.NEXT_PUBLIC_ENABLE_LOCAL_FEATURES === 'true') {
    if (featureName in SERVER_LOCAL_FEATURE_OVERRIDES) {
      logger.info('switchboard.server.local-override', {
        featureName,
        value: SERVER_LOCAL_FEATURE_OVERRIDES[featureName],
      });
      return SERVER_LOCAL_FEATURE_OVERRIDES[featureName];
    }
  }

  const rootDomain = getRootDomainFromHeaders(headers);

  if (!rootDomain) {
    logger.warn('switchboard.server.no-root-domain', {
      featureName,
      message: 'Cannot check feature flag: no root domain',
    });
    return false;
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
      return false;
    }

    const data = await response.json();
    return data?.setting ?? false;
  } catch (error) {
    logger.error('switchboard.server.fetch-error', {
      featureName,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
