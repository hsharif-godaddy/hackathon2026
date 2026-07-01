import { NextResponse } from 'next/server';

import { airoAppDomainForHost, decodeSharePayloadEdge } from '@/lib/share/edge-decode';
import gasket from '../gasket.edge';

export const config = {
  matcher: [
    '/',
    // Match other paths EXCEPT /api, /_next, static assets, /.well-known, etc.
    // scripts/ is excluded like images/ and _next/ so receive-bridge.js is served as a
    // public static file without auth middleware intercepting the <script src> request.
    '/((?!api|_next|images|scripts|favicon.ico|sitemap.xml|robots.txt|notification-beep.wav|\\.well-known).*)'
  ]
}

const SHARE_PREFIX = '/share/';

// `?p=<path>` lets the share-create caller (e.g. PaaS screenshot capture for
// apps configured with a non-root rootPath like /blog) ask the BFF to redirect
// recipients to that path on the previewed app, instead of always to host
// root. The constraints below are an open-redirect guard: the value MUST be a
// same-host absolute path (no scheme, no host, no protocol-relative `//`, no
// backslashes, no fragment) bounded by length. Validation here is paired with
// the explicit host assertion after `new URL(...)` below — both layers must
// agree before we issue the 307.
const SHARE_PATH_QUERY = 'p';
const SHARE_PATH_MAX_LEN = 128;
const SHARE_PATH_REGEX = /^\/[A-Za-z0-9_\-./~]*$/;

function resolveSharePath(raw: string | null): string {
  if (!raw) return '/';
  if (raw.length > SHARE_PATH_MAX_LEN) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (!SHARE_PATH_REGEX.test(raw)) return '/';
  return raw;
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

// Dashboard hosts that are legitimately allowed to embed builder pages.
// MUST stay in sync with the `frame-ancestors` directive in gasket.ts:372
// (Gasket Helmet config). Difference: the gasket version also includes
// `'self'`, which we deliberately omit here for the develop-page CSP —
// see DEVELOP_FRAME_ANCESTORS_CSP below.
const DEVELOP_FRAME_ANCESTORS_CSP = [
  'frame-ancestors',
  'https://dashboard.godaddy.com',
  'https://dashboard.godaddy.com:*',
  'https://dashboard.dev-godaddy.com',
  'https://dashboard.dev-godaddy.com:*',
  'https://dashboard.test-godaddy.com',
  'https://dashboard.test-godaddy.com:*',
].join(' ');

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
      // Defense in depth: resolveSharePath gates the input on charset/length
      // before we ever construct a URL; the post-construction host assertion
      // is the second layer that catches anything the regex missed (e.g. a
      // future spec change in URL parsing). Any mismatch falls back to '/'.
      const requestedPath = resolveSharePath(requestUrl.searchParams.get(SHARE_PATH_QUERY));
      const baseUrl = `https://${previewHost}`;
      const targetUrl = new URL(`${requestedPath}?airoShareToken=${encodeURIComponent(payload.token)}`, baseUrl);
      const target = targetUrl.host === previewHost
        ? targetUrl.toString()
        : `${baseUrl}/?airoShareToken=${encodeURIComponent(payload.token)}`;
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

  // Prevent the develop page from being framed by ITSELF (defense
  // against the preview iframe's first-load auth race: when
  // dev-supervisor 307s to JWT_REDIRECT_URL = builder/develop/<appId>,
  // the iframe would otherwise render the builder inside itself, mount
  // its own preview iframe, and recurse).
  //
  // Critically: we do NOT use `frame-ancestors 'none'` here. The Gasket
  // Helmet CSP (gasket.ts:372) already includes `'self'` plus the
  // GoDaddy dashboard hostnames so legitimate dashboard embedding works.
  // Setting 'none' here would override that and break the dashboard-
  // embed scenario (FrameBuster, IframeCloseButton, etc.).
  // Instead we set a CSP that omits `'self'` while keeping the dashboard
  // allowlist — both CSPs must agree, so `'self'` framing (the
  // recursion path) is blocked while the dashboard origins (which both
  // CSPs allow) still work.
  //
  // Pathname match covers both the bare `/develop/<id>` form (the URL
  // the user actually navigates to — see middleware.test.ts:114 where
  // input is `/develop/abc-123` rewriting to `/en-US/develop/abc-123`)
  // AND the market-prefixed form (in case the request ever arrives
  // already-prefixed).
  if (/^\/(?:[^/]+\/)?develop(\/|$)/.test(pathname)) {
    response.headers.set('Content-Security-Policy', DEVELOP_FRAME_ANCESTORS_CSP);
  }

  return response;
}
