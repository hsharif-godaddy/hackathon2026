import { gzipSync } from 'node:zlib';

import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { collectInvestigateEvidence, normalizeEvidenceRequest } from '@/lib/investigate/evidence';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE = 'no-store, no-cache, must-revalidate, max-age=0';

// Heavy log-volume apps over a 7d window can produce response bodies in the
// tens of MB. JSON compresses 5–10× — gzipping cuts wire bytes, transfer time,
// and Lambda's outbound-billed seconds. Investigator's Node `fetch` (undici)
// auto-decompresses based on Content-Encoding, so the caller sees the same
// decoded JSON. Browsers/curl set Accept-Encoding by default too.
function maybeGzipJson(payload: unknown, request: Request, status = 200): Response {
  const body = JSON.stringify(payload);
  // Intentionally ignores RFC q-values: `gzip;q=0` (rejection) would be
  // treated as acceptance here. No real client (browser, undici, curl)
  // emits q=0 for gzip, so the extra parsing isn't worth the code.
  const acceptsGzip = (request.headers.get('accept-encoding') ?? '')
    .toLowerCase()
    .split(',')
    .some((enc) => enc.trim().split(';')[0] === 'gzip');
  // No `Vary: Accept-Encoding` header. Cache-Control: no-store below
  // already prevents intermediary caching, so Vary would be redundant.
  const plainResponse = (): Response => new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE },
  });
  if (!acceptsGzip) return plainResponse();
  // gzipSync can throw on extreme OOM. Fall back to plain JSON so the
  // route's response envelope (status + cache headers) stays consistent
  // instead of bubbling a 500 with no headers set.
  let gzipped: Buffer;
  try {
    gzipped = gzipSync(body);
  } catch {
    return plainResponse();
  }
  return new Response(new Uint8Array(gzipped), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Cache-Control': NO_STORE,
    },
  });
}

export const POST = withAuth(async (request) => {
  let normalized;
  try {
    normalized = normalizeEvidenceRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid evidence request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: { 'Cache-Control': NO_STORE } },
    );
  }

  let evidence;
  try {
    evidence = await collectInvestigateEvidence(normalized);
  } catch (error) {
    return NextResponse.json(
      { error: 'Evidence collection failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': NO_STORE } },
    );
  }

  return maybeGzipJson(evidence, request);
});
