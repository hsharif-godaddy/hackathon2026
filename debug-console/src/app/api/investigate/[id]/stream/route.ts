import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { readEventsSince } from '@/lib/investigate/events';
import { isTerminal, readState } from '@/lib/investigate/state';
import { isTerminalEvent, keysForInvestigation } from '@/lib/investigate/types';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
// Cap below Lambda's 15min wall — connection held open regardless of activity.
// Next.js Node runtime has no hard streaming limit; a ceiling keeps us from
// accumulating zombie connections if clients disconnect without ECONNRESET.
export const maxDuration = 900;

const POLL_INTERVAL_MS = 500;
const KEEPALIVE_INTERVAL_MS = 15_000;
const HARD_TIMEOUT_MS = 14 * 60_000;

function sseFrame(event: string, data: string, id?: number): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  // SSE spec: data lines must not contain raw newlines; split if present.
  for (const line of data.split('\n')) lines.push(`data: ${line}`);
  lines.push('', '');
  return lines.join('\n');
}

export const GET = withAuth<{ id: string }>(async (request, _auth, context) => {
  const { id: investigationId } = await context.params;
  const url = new URL(request.url);
  const appId = url.searchParams.get('appId');
  const customerId = url.searchParams.get('customerId');

  if (!appId || !customerId) {
    return NextResponse.json({ error: 'appId and customerId are required' }, { status: 400 });
  }

  const lastEventIdHeader = request.headers.get('last-event-id');
  const lastEventIdQuery = url.searchParams.get('lastEventId');
  // EventSource auto-sets Last-Event-ID on reconnect. Query param lets manual
  // callers resume too.
  const parsedLast = Number.parseInt(lastEventIdHeader ?? lastEventIdQuery ?? '0', 10);
  const initialSeq = Number.isFinite(parsedLast) && parsedLast >= 0 ? parsedLast : 0;

  const keys = keysForInvestigation(customerId, appId, investigationId);

  // Verify investigation exists + belongs to this (cust, app). Prevents a
  // client guessing IDs from tailing arbitrary prefixes. Reads state (not
  // events) because state is the authoritative "who owns this slot" record
  // during dual-write rollout.
  let state;
  try {
    state = await readState(keys.stateKey);
  } catch (err) {
    logger.error(
      'investigate.stream.state.read.failed',
      { investigationId, appId, customerId },
      { error: err as Error },
    );
    return NextResponse.json({ error: 'state_read_failed' }, { status: 503 });
  }
  if (!state) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (state.investigationId !== investigationId) {
    return NextResponse.json({ error: 'superseded', current: state.investigationId }, { status: 410 });
  }

  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let lastSeq = initialSeq;
      let closed = false;
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
      let hardTimer: ReturnType<typeof setTimeout> | null = null;

      const safeEnqueue = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const close = (reason: string): void => {
        if (closed) return;
        closed = true;
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        if (hardTimer) clearTimeout(hardTimer);
        try {
          controller.enqueue(encoder.encode(sseFrame('close', JSON.stringify({ reason }))));
        } catch {
          /* already closed */
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const abortHandler = (): void => close('client_disconnect');
      signal.addEventListener('abort', abortHandler, { once: true });

      keepaliveTimer = setInterval(() => {
        if (!safeEnqueue(`: keepalive\n\n`)) close('enqueue_failed');
      }, KEEPALIVE_INTERVAL_MS);

      hardTimer = setTimeout(() => close('server_timeout'), HARD_TIMEOUT_MS);

      // Prelude: tell client the resume seq and the state snapshot so they
      // can hydrate even if they opened the stream mid-run without prior
      // /status call.
      safeEnqueue(
        sseFrame(
          'hello',
          JSON.stringify({
            investigationId,
            resumeFromSeq: lastSeq,
            status: state.status,
            startedAt: state.startedAt,
          }),
        ),
      );

      // If the investigation is already terminal, flush any unread events and
      // close. Avoids spinning a 14-min poll loop for a finished run.
      const alreadyTerminal = isTerminal(state.status);

      const pollOnce = async (): Promise<boolean> => {
        if (closed) return false;
        let events;
        try {
          events = await readEventsSince(keys.eventsPrefix, lastSeq);
        } catch (err) {
          logger.error(
            'investigate.stream.events.read.failed',
            { investigationId, lastSeq },
            { error: err as Error },
          );
          close('events_read_failed');
          return false;
        }

        for (const evt of events) {
          if (evt.seq <= lastSeq) continue;
          safeEnqueue(sseFrame(evt.type, JSON.stringify(evt), evt.seq));
          lastSeq = evt.seq;
          if (isTerminalEvent(evt)) {
            close('terminal_event');
            return false;
          }
        }
        return true;
      };

      // First tick immediately.
      const keepGoing = await pollOnce();
      if (!keepGoing) return;
      if (alreadyTerminal) {
        // Dual-write rollout safety: state is terminal but the terminal event
        // may not have been emitted (Lambda pre-event-log, or emit failed).
        // Synthesize a close so the client doesn't hang.
        close('state_terminal');
        return;
      }

      // Main loop: setTimeout chain, not setInterval. setInterval does not
      // await async callbacks, so if pollOnce runs long (S3 throttling) ticks
      // overlap and `lastSeq` races across parallel calls.
      const scheduleNext = (): void => {
        if (closed) return;
        setTimeout(async () => {
          if (closed) return;
          const cont = await pollOnce();
          if (cont) scheduleNext();
        }, POLL_INTERVAL_MS);
      };
      scheduleNext();
    },
    cancel(): void {
      // Client aborted. `signal` handler above does the close; this is the
      // ReadableStream's own cleanup hook.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
