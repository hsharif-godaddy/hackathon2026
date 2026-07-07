import { NextRequest, NextResponse } from 'next/server';

import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { DCC_API_URL_PROD, DCC_API_URL_TEST, generateDomainConnectSignature } from '@/lib/dcc-domain-attach-client';
import { publicOrigin } from '@/lib/github/config';
import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag } from '@/lib/switchboard/server';
import { parseDomain } from '@/utils/domain';
import { buildNonceCookieName } from '../_utils';

export const dynamic = 'force-dynamic';

const SWITCHBOARD_FLAG = 'appbuilder-connect-external-domain';
const NONCE_COOKIE_MAX_AGE_SECONDS = 300;
// The providerId from our Domain Connect templates (godaddy.com.aab*.json).
// Not a secret — it's the same value that appears in the published template files.
const DOMAIN_CONNECT_PROVIDER_ID = 'godaddy.com';

const SUPPORTED_PROVIDERS = ['cloudflare'] as const;
type SupportedProvider = typeof SUPPORTED_PROVIDERS[number];

function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

function buildState(appId: string, fqdn: string, nonce: string): string {
  const payload: string = JSON.stringify({ appId, fqdn, nonce });
  return Buffer.from(payload).toString('base64url');
}

/**
 * GET /api/apps/[id]/domain-connect/[provider]/url
 *
 * Returns the Domain Connect provider URL the browser should navigate to.
 * Sets a short-lived httpOnly nonce cookie for CSRF protection on the callback.
 *
 * Query params:
 *   fqdn (required) — domain to connect
 */
export const GET = withCustomerAuth(
  async (
    request: NextRequest,
    authContext: CustomerAuthContext,
    { params }: { params: Promise<{ id: string; provider: string }> },
  ): Promise<NextResponse> => {
    const { id: appId, provider } = await params;

    if (!authContext.jwt) {
      return NextResponse.json({ error: 'Authentication token required' }, { status: 401 });
    }

    const enabled = await checkSwitchboardFlag(SWITCHBOARD_FLAG, request);
    if (!enabled) {
      return NextResponse.json({ error: 'Feature not enabled' }, { status: 403 });
    }

    if (!isSupportedProvider(provider)) {
      return NextResponse.json(
        { error: `Unsupported provider: ${provider}` },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(request.url);
    const fqdn: string | null = searchParams.get('fqdn');
    const v1: string | null = searchParams.get('v1');
    const dcv: string | null = searchParams.get('dcv');
    const dkimSuffix: string | null = searchParams.get('dkimSuffix');
    if (!fqdn || !v1 || !dcv) {
      return NextResponse.json(
        { error: 'fqdn, v1, and dcv query parameters are required' },
        { status: 400 },
      );
    }

    // Domain Connect async flow URL:
    // https://dash.cloudflare.com/domainconnect/v2/domainTemplates/providers/{providerId}/services/{serviceId}/apply
    // serviceId matches the template filename: godaddy.com.aab.json → aab, godaddy.com.aab_subdomain.json → aab_subdomain
    const isSubdomain: boolean = parseDomain(fqdn)?.isSubdomain ?? false;
    const serviceId: string = isSubdomain ? 'aab_subdomain' : 'aab';

    const nonce: string = crypto.randomUUID();
    const state: string = buildState(appId, fqdn, nonce);
    const origin: string = publicOrigin(request);
    const redirectUri: string = `${origin}/api/apps/${appId}/domain-connect/${provider}/callback`;

    // DCC signing requires params in alphabetical order; the URL must present
    // them in the same order so Cloudflare's query-string verification matches.
    const rawParams: Record<string, string> = { domain: fqdn, redirect_uri: redirectUri, state, v1, dcv };
    if (dkimSuffix) rawParams.dkimSuffix = dkimSuffix;
    const sortedParams: [string, string][] = Object.entries(rawParams)
      .sort(([a], [b]) => a.localeCompare(b)) as [string, string][];

    const connectUrl: URL = new URL(
      `https://dash.cloudflare.com/domainconnect/v2/domainTemplates/providers/${DOMAIN_CONNECT_PROVIDER_ID}/services/${serviceId}/apply`,
    );
    for (const [key, value] of sortedParams) {
      connectUrl.searchParams.set(key, value);
    }

    const queryParams: Record<string, string> = Object.fromEntries(sortedParams) as Record<string, string>;

    // GASKET_ENV is safe here: this file is an API route, never bundled for the browser.
    const dccBaseUrl: string = process.env.DCC_DOMAIN_ATTACH_API_URL
      ?? (process.env.GASKET_ENV === 'production' ? DCC_API_URL_PROD : DCC_API_URL_TEST);

    try {
      const { signature, keyName } = await generateDomainConnectSignature(queryParams, authContext.jwt, dccBaseUrl);

      connectUrl.searchParams.set('sig', signature);
      connectUrl.searchParams.set('key', keyName);

      logger.info('domain-connect.url.signed', { appId, fqdn, provider, keyName });
    } catch (error: unknown) {
      logger.error('domain-connect.url.signature_failed', {
        message: 'Failed to sign Domain Connect URL',
        appId,
        fqdn,
        provider,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return error to client
      return NextResponse.json(
        { error: 'Failed to generate Domain Connect signature' },
        { status: 502 },
      );
    }

    logger.info('domain-connect.url.generated', { appId, fqdn, provider });

    const response: NextResponse = NextResponse.json({ url: connectUrl.toString() });
    const cookieName: string = buildNonceCookieName(appId);
    response.headers.set(
      'Set-Cookie',
      `${cookieName}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${NONCE_COOKIE_MAX_AGE_SECONDS}`,
    );
    return response;
  },
  { level: 3 },
);
