/**
 * User-visible Getty proxy configuration messages (keep dev-runner preflight copy aligned).
 *
 * Auth is implemented by `BaseDriverV2` (`USE_S2S_AUTH`, `S2S_AWS_PROFILE`, `SSO_HOST`).
 * Drivers use `GETTY_IMAGE_PROXY_URL` when set; otherwise the dev direct proxy URL.
 */

export const GETTY_CONFIG_HELP =
  'Set USE_S2S_AUTH=true and use an AWS SSO profile (e.g. airobuild-dev-private-sso).';

export const GETTY_CONFIG_NOT_CONFIGURED_MESSAGE = `Authentication not configured. ${GETTY_CONFIG_HELP}`;

export const GETTY_CONFIG_LEGACY_TOKEN_NOTICE = `GETTY_TOKEN is no longer used. Configure Getty with ${GETTY_CONFIG_HELP} Remove GETTY_TOKEN.`;

export const GETTY_CONFIG_MEDIA_AUTH_MISSING = `USE_S2S_AUTH is not set. ${GETTY_CONFIG_HELP}`;
