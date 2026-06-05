import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { captureOperatorLesson } from '@/lib/investigate/lessons';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

// investigationId is interpolated into the S3 key, so constrain it to a safe
// charset (no path traversal). Mirrors INV_ID_RE in lib/investigate/types.ts.
const INV_ID_RE = /^[A-Za-z0-9_.-]+$/;

// POST /api/investigate/:id/lesson
// Body: { appId, customerId, note }
//
// Operator marks an investigation finding a false positive. Persists a
// candidate lesson to the S3 lessons inbox for human curation into
// references/aab-behaviors.md (the investigator's knowledge base). This is the
// operator capture half of the feedback loop; the verifier auto-captures the
// other half from the Lambda.
export const POST = withAuth<{ id: string }>(async (request, _auth, context) => {
  const { id: investigationId } = await (context as RouteContext).params;
  if (!investigationId || !INV_ID_RE.test(investigationId)) {
    return NextResponse.json({ error: 'invalid investigationId' }, { status: 400 });
  }

  let body: { appId?: string; customerId?: string; note?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const appId = typeof body.appId === 'string' ? body.appId : '';
  const customerId = typeof body.customerId === 'string' ? body.customerId : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!appId || !customerId) {
    return NextResponse.json({ error: 'appId and customerId are required' }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: 'note is required' }, { status: 400 });
  }

  try {
    const { key } = await captureOperatorLesson({ investigationId, appId, customerId, note });
    logger.info('investigate.lesson.captured', { investigationId, appId, customerId, key });
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    logger.error(
      'investigate.lesson.capture.failed',
      { investigationId, appId, customerId },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'lesson_capture_failed' }, { status: 503 });
  }
});
