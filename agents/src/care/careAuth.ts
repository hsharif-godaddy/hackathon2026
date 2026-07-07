import {
  getS2STokenV2,
  refreshS2STokenV2,
  isS2SAuthV2Enabled,
  type S2SAuthV2Config,
} from '@airo/ai-lib';

import { errorFields, Logger } from '../logging/index.js';
import { getDefaultS2SConfigV2 } from '../utils/s2s-config.js';

const logger = Logger.create({ component: 'care-auth' });

const NO_AUTH_MESSAGE =
  'No Care s2s auth configured. Set USE_S2S_AUTH=true (hosted) or SSO_JWT (local).';

/**
 * Returns a raw GoDaddy s2s JWT for Airo Care. The caller (Airo Care client
 * authenticator) prepends the `sso-jwt` scheme and pairs it with X-Delegated-For,
 * so this returns the bare token with no scheme prefix.
 */
export async function getCareS2SToken(): Promise<string> {
  if (isS2SAuthV2Enabled()) {
    const config: S2SAuthV2Config = getDefaultS2SConfigV2();
    logger.info('care.s2s.token.source', {
      mode: 's2s',
      awsProfile: config.awsProfile,
      ssoHost: config.ssoHost,
    });
    try {
      return await getS2STokenV2(config);
    } catch (err) {
      logger.error('care.s2s.token.failed', { awsProfile: config.awsProfile, ssoHost: config.ssoHost, ...errorFields(err) });
      throw err;
    }
  }
  const localJwt: string = (process.env.SSO_JWT ?? '').trim();
  if (localJwt) {
    logger.info('care.s2s.token.source', { mode: 'local_sso_jwt' });
    return localJwt;
  }
  logger.warn('care.s2s.auth.missing', { hint: 'set USE_S2S_AUTH=true or SSO_JWT' });
  throw new Error(NO_AUTH_MESSAGE);
}

/**
 * Forces a fresh IAM-issued token (for the reactive 401-retry path, DC-18066).
 * Requires S2S auth — there is no SSO_JWT local-dev fallback here, since a static
 * local token has nothing to refresh. Throws when USE_S2S_AUTH is unset so the
 * failure is actionable rather than an opaque AWS credential-chain error.
 */
export async function refreshCareS2SToken(): Promise<string> {
  if (!isS2SAuthV2Enabled()) {
    throw new Error(NO_AUTH_MESSAGE);
  }
  const config: S2SAuthV2Config = getDefaultS2SConfigV2();
  logger.info('care.s2s.token.refresh', {
    awsProfile: config.awsProfile,
    ssoHost: config.ssoHost,
  });
  return refreshS2STokenV2(config);
}
