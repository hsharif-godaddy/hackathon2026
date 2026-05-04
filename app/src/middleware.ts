import { NextResponse } from 'next/server';

import { airoAppDomainForHost, decodeSharePayloadEdge } from '@/lib/share/edge-decode';
import gasket from '../gasket.edge';

export const config = {
  matcher: [
    '/',
    // Match other paths EXCEPT /api, /_next, static assets, /.well-known, etc.
    '/((?!api|_next|images|favicon.ico|sitemap.xml|robots.txt|notification-beep.wav|\\.well-known).*)'
  ]
}

const SHARE_PREFIX = '/share/';

// Includes lower envs so deploys are self-verifying (curl test env after promote → header should appear)
// and so internal URLs that may leak don't get indexed. Excludes godaddy.com apex so the FOS SLP stays indexable.
const NOINDEX_HOSTS = new Set([
  'airo-builder.godaddy.com',
  'airo-builder.test-godaddy.com',
  'airo-builder.dev-godaddy.com',
  'pre-test-airo-builder.test-godaddy.com'
]);

// Akamai overwrites the Host header with the internal origin hostname before forwarding to the
// app, and stashes the real public host in x-dsa-host. This matches the precedence used by
// @godaddy/gasket-plugin-traffic/lib/utils.js for the same reason. Falls back to host for
// envs without Akamai (local dev, tests).
function getPublicHost(request: Request): string {
  const raw = request.headers.get('x-dsa-host')
    ?? request.headers.get('host')
    ?? '';
  return raw.toLowerCase().split(':')[0];
}

/** @type {import('next/server').NextMiddleware} */
export async function middleware(request: Request) {
  const requestUrl = new URL(request.url);
  const { pathname, search } = requestUrl;

  // Fast path: /share/{encoded} → 307 directly to the preview URL.
  // Without this, the request would render the full [market]/layout (which
  // awaits translations + experiment cohorts) before the Server Component
  // finally calls redirect(), so recipients see a brief Airo-purple shell
  // flash. By redirecting in middleware we skip layout/page rendering
  // entirely. Invalid payloads fall through to the rewrite below, where
  // page.tsx calls notFound() and returns a real 404.
  if (pathname.startsWith(SHARE_PREFIX)) {
    const encoded = pathname.slice(SHARE_PREFIX.length);
    const payload = decodeSharePayloadEdge(encoded);
    if (payload) {
      // Use getPublicHost (NOT requestUrl.host) — same reason the
      // NOINDEX_HOSTS check below does. Akamai rewrites the Host header
      // to an internal Katana origin before the request reaches Next.js,
      // so requestUrl.host would resolve to that internal hostname,
      // miss every entry in airoAppDomainForHost's known-host map, and
      // fall through to the test-airoapp.ai default — silently routing
      // every production share link to the wrong domain. The original
      // public host survives in x-dsa-host.
      const baseDomain = airoAppDomainForHost(getPublicHost(request));
      const previewHost = `${payload.siteId}.preview.${payload.cellPrefix}.${baseDomain}`;
      const target = `https://${previewHost}/?airoShareToken=${payload.token}`;
      return NextResponse.redirect(target, 307);
    }
  }

  const visitor = await gasket.actions.getVisitor(request);
  const { market } = visitor;

  const targetPathname = [market, pathname.slice(1)].filter(Boolean).join('/');
  const response = NextResponse.rewrite(new URL(`/${targetPathname}${search}`, request.url));

  // Header can't be overridden by route generateMetadata, so this wins over per-page robots metadata.
  if (NOINDEX_HOSTS.has(getPublicHost(request))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return response;
}
