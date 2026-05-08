import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { collectInvestigateEvidence, normalizeEvidenceRequest } from '@/lib/investigate/evidence';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const POST = withAuth(async (request) => {
  let normalized;
  try {
    normalized = normalizeEvidenceRequest(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: 'Invalid evidence request', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
    );
  }

  let evidence;
  try {
    evidence = await collectInvestigateEvidence(normalized);
  } catch (error) {
    return NextResponse.json(
      { error: 'Evidence collection failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' } },
    );
  }

  return NextResponse.json(evidence, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' },
  });
});
