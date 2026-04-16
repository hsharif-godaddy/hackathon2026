import { logger } from '@/lib/request-context';

/**
 * Shim React 18's __SECRET_INTERNALS onto React 19 for legacy UMD bundles.
 *
 * Next.js 16 vendors React 19 which renamed the internals property from
 * __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED to
 * __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.
 *
 * Remote checkout bundles (e.g. cart CDN's express.js loaded by @px/checkouts)
 * read window.React and expect the React 18 internals path. This shim bridges
 * the gap so their jsx-runtime can find ReactCurrentOwner.
 *
 * Remove once the cart team ships a React 19-compatible express.js bundle.
 */
export function shimReactInternals(): void {
  if (typeof window === 'undefined') return;

  const react = (window as any).React;
  if (!react) {
    logger.warn('reactCompat.shim.skipped', { reason: 'window.React not set' });
    return;
  }
  if (react.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED) return;

  const internals = react.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  if (internals) {
    react.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = internals;
  } else {
    logger.warn('reactCompat.shim.skipped', {
      reason: 'React 19 internals key not found on window.React',
      reactVersion: react.version,
    });
  }
}
