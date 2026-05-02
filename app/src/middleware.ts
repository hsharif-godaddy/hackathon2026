import { NextResponse } from 'next/server';

import gasket from '../gasket.edge';

export const config = {
  matcher: [
    '/',
    // Match other paths EXCEPT /api, /_next, static assets, /.well-known, etc.
    '/((?!api|_next|images|favicon.ico|sitemap.xml|robots.txt|notification-beep.wav|\\.well-known).*)'
  ]
}

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
