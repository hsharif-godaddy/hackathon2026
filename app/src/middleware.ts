import { NextResponse } from 'next/server';

import gasket from '../gasket.edge';

export const config = {
  matcher: [
    '/',
    // Match other paths EXCEPT /api, /_next, static assets, /.well-known, etc.
    '/((?!api|_next|images|favicon.ico|sitemap.xml|robots.txt|notification-beep.wav|\\.well-known).*)'
  ]
}

/** @type {import('next/server').NextMiddleware} */
export async function middleware(request: Request) {
  const requestUrl = new URL(request.url);
  const { pathname, search } = requestUrl;

  const visitor = await gasket.actions.getVisitor(request);
  const { market } = visitor;

  const targetPathname = [market, pathname.slice(1)].filter(Boolean).join('/');
  const response = NextResponse.rewrite(new URL(`/${targetPathname}${search}`, request.url));

  // Host-gated so the godaddy.com SLP stays indexable; header can't be overridden by route generateMetadata.
  if (requestUrl.hostname === 'airo-builder.godaddy.com') {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  return response;
}
