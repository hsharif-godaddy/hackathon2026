import { notFound, redirect } from 'next/navigation';
import { decodeSharePayload } from '@airo/shared';

import { logger } from '@/lib/request-context';
import { buildPreviewUrl } from '@/lib/share/preview-url';

// Reachable by unauthenticated share recipients. Two layers of evidence,
// both verified by static config inspection (not by a live HTTP request
// through the Gasket proxy stack):
//   1. Proxy layer: @godaddy/gasket-plugin-auth/lib/express.js gates routes
//      only when gasket.config.auth.authRoutes is populated. Our gasket.ts
//      auth block has no authRoutes, so the express middleware returns null
//      and never intercepts requests. A regression-guard test in
//      page.test.tsx asserts authRoutes remains absent.
//   2. Client layer: AuthProvider and ProtectedRoute are 'use client' — this
//      Server Component's redirect() throws before the client tree mounts,
//      so they never run.
export const dynamic = 'force-dynamic';

interface SharePageProps {
  params: Promise<{ market: string; encoded: string }>;
}

export default async function SharePage({ params }: SharePageProps) {
  const { encoded } = await params;
  const payload = decodeSharePayload(encoded);

  if (!payload) {
    // Log a short prefix of the encoded segment so failures can be correlated
    // with logs/traces; the full segment is already in the URL so this is not
    // additional disclosure. `encoded` is non-optional per the App Router
    // params contract, so direct .slice/.length is safe.
    logger.warn('share.redirect.invalidPayload', {
      encodedLength: encoded.length,
      encodedPrefix: encoded.slice(0, 8),
    });
    // notFound() returns a real 404 + renders the not-found page. A redirect
    // to '/' would look like success in monitoring and leave recipients with
    // no indication the link is broken.
    notFound();
  }

  const previewUrl = buildPreviewUrl(payload.siteId, payload.cellPrefix);
  // Token charset is base64url-safe per share-token-generator; no encodeURIComponent needed
  const target = `${previewUrl}?airoShareToken=${payload.token}`;

  logger.info('share.redirect.success', {
    siteId: payload.siteId,
    cellPrefix: payload.cellPrefix,
  });

  return redirect(target);
}
