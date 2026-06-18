import { cookies } from 'next/headers';

import { getSsoHostSync } from '@/lib/gasket-config';

/**
 * Care-agent / delegated session indicator.
 *
 * PresentationCentral's `manifest: 'no-header'` ships a bundle (`no-header.js`)
 * whose Header component renders empty markup — including no delegation row —
 * even when bootstrap props set `accountDelegationBanner: true`. Apps using
 * `application-header` get the bar via PC's shared chrome; we lose it.
 *
 * This server component reads the standard `info_idp` cookie (same source PC
 * uses) and renders the equivalent "X logged in as: Y / Stop impersonation"
 * row at the top of the layout. Returns null for non-impersonated sessions.
 *
 * Trust note: `info_idp` is a plaintext, client-readable cookie, so we ONLY
 * use it for display (names + Stop link). Behavior gating that depends on
 * impersonation must come from `tokenAuthType` (validated JWT), not this
 * cookie.
 */
const IMPERSONATION_AUTH_TYPES = new Set([
  'e2s',
  'e2s2s',
  'e2s2p',
  'e2s2snpr',
  'e2s2s2p',
  'cert2s',
]);

type Delegator = {
  typ?: string;
  firstname?: string;
  lastname?: string;
  info_accountName?: string;
};

type TargetShopper = {
  firstname?: string;
  lastname?: string;
  info_shopperId?: string;
};

type InfoIdp = {
  auth?: string;
  del?: Delegator;
} & {
  [key: string]: unknown;
};

function parseInfoIdp(raw: string | undefined): InfoIdp | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as InfoIdp;
    }
    return null;
  } catch {
    // Cookie corrupted, malformed JSON, or invalid URL escape — render nothing.
    return null;
  }
}

export async function DelegationBanner() {
  const cookieStore = await cookies();
  const info = parseInfoIdp(cookieStore.get('info_idp')?.value);

  if (!info?.auth || !IMPERSONATION_AUTH_TYPES.has(info.auth)) {
    return null;
  }

  const targetBlock = info[info.auth] as TargetShopper | undefined;
  const impersonatorFirst = info.del?.firstname;
  const targetName = [targetBlock?.firstname, targetBlock?.lastname]
    .filter(Boolean)
    .join(' ');

  if (!impersonatorFirst || !targetName) {
    return null;
  }

  // Authoritative SSO host derives from SSO_LOGIN_URL — same source used by
  // gd-auth-service.ts, iam-token.ts, and startup-config.ts. Avoids the
  // request-header derivation pitfall where Akamai overwrites Host with an
  // internal origin in deployed envs (would otherwise risk routing to test
  // SSO from production when x-dsa-host is absent).
  const switchbackUrl = `https://${getSsoHostSync()}/cookie/switchback`;

  // Reuse PC's standard delegation classes — they're already shipped in
  // no-header.css (`.delegation`, `.delegate.rep`, `.delegate-link`) with
  // proper colors, fixed-position-at-top behavior at ≥520px, and the
  // `--delegate-height: 40px` spacer pattern. Pixel-parity with the
  // standard GoDaddy delegation bar across other GoDaddy properties.
  return (
    <div
      className="delegation"
      role="status"
      aria-live="polite"
      data-testid="airo-delegation-banner"
    >
      <div className="delegate rep">
        <span>
          {impersonatorFirst} logged in as: {targetName}
        </span>
        <a className="delegate-link" href={switchbackUrl}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M19 6.4L17.6 5L12 10.6L6.4 5L5 6.4L10.6 12L5 17.6L6.4 19L12 13.4L17.6 19L19 17.6L13.4 12L19 6.4Z"
              fill="currentColor"
            />
          </svg>
          {' '}
          <span>Stop impersonation</span>
        </a>
      </div>
    </div>
  );
}
