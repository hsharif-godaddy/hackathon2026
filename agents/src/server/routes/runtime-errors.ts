/**
 * Runtime Errors Route
 *
 * Receives runtime-error payloads forwarded by the builder parent (`app/`)
 * via authenticated `agentFetch`. The parent listens for `error-fix-request`
 * postMessages from the preview iframe (ReactErrorBoundary, global handlers,
 * initial-error) and forwards the shaped payload here.
 *
 * Pipeline:
 *   preview iframe → postMessage → app/ develop/[id]/page.tsx →
 *   agentFetch POST /apps/:id/runtime-errors → RuntimeErrorBuffer.push →
 *   post-stream-validator runtime phase → agent continuation.
 *
 * The route sits behind JWT + `validateAppOwnership`, so the preview
 * sandbox cannot ingest errors into another app's buffer and there is no
 * public write surface. Length-clamping in `sanitizePayload` keeps a
 * compromised preview from bloating the buffer past a few KB per entry.
 *
 * Responses: authorized + well-formed requests always get 204 (no body),
 * whether the payload was accepted, deduped, or quietly dropped by the
 * sanitizer — we don't leak accept/drop state back to the preview. The
 * only non-204 paths are infrastructure errors: 400 when `:id` is missing
 * from the route, and 401/403 from the JWT + `validateAppOwnership`
 * middleware ahead of this handler.
 *
 * ## Cycle endpoint
 *
 * Cycle-aware previews (dev-tools v8 and later) also POST to
 * `/apps/:id/runtime-errors/cycle` at every HMR boundary + on init, with
 * `{ cycleId: <monotonic number> }`. That tells the server the preview
 * has started a new render generation and any buffered entries from
 * prior generations should be evicted. See `runtime-error-buffer.ts` for
 * the full semantics. This closes the "mid-turn transient error" class
 * of ghost, where an intermediate edit throws, a later edit in the same
 * turn fixes it, but the ghost entry otherwise survives to the next
 * validator drain.
 */

import { Router, Request, Response, IRouter } from 'express';

import { Logger } from '../../logging/index.js';
import { validateAppOwnership } from '../middleware/app-ownership.js';
import { runtimeErrorBuffer, type RuntimeErrorEntry } from '../../services/runtime-error-buffer.js';

const logger = Logger.create({ component: 'runtime-errors-routes' });

/**
 * Field-length caps applied to the incoming payload before buffering.
 * Acts as prompt-hygiene: these strings are eventually interpolated into
 * the agent's continuation prompt, so we want to defend against a
 * compromised preview injecting a multi-megabyte "error message" to push
 * instructions past the agent's context window.
 *
 * Values are generous relative to real-world errors (React stacks are
 * typically ~2KB) but tight enough that a single entry can't bloat past
 * a few KB.
 */
const MAX_MESSAGE_LEN = 4_000;
const MAX_STACK_LEN = 16_000;
const MAX_COMPONENT_STACK_LEN = 16_000;
const MAX_URL_LEN = 2_000;
const MAX_NAME_LEN = 200;

function clamp(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

interface SanitizedPayload {
  entry: RuntimeErrorEntry;
  cycleId: number;
}

function sanitizePayload(body: unknown): SanitizedPayload | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;

  const message = clamp(raw.message, MAX_MESSAGE_LEN);
  const name = clamp(raw.name, MAX_NAME_LEN);
  if (!message || !name) return null;

  // `cycleId` is required. The preview always has one (seeded at dev-
  // tools load, advanced on every HMR boundary) and posting without it
  // means the caller isn't the cycle-aware pipeline we expect — drop
  // to fail-closed.
  if (typeof raw.cycleId !== 'number' || !Number.isFinite(raw.cycleId)) {
    return null;
  }
  const cycleId = raw.cycleId;

  const stack = clamp(raw.stack, MAX_STACK_LEN);
  const componentStack = clamp(raw.componentStack, MAX_COMPONENT_STACK_LEN);
  const url = clamp(raw.url, MAX_URL_LEN);

  // Always stamp server-side. A client-supplied `timestamp` is ignored
  // on purpose — we don't need a second, untrusted, non-monotonic time
  // source. The buffer's `pushedAt` is the canonical push time, used
  // only for the in-cycle push-dedup window.
  const timestamp = Date.now();

  const entry: RuntimeErrorEntry = {
    message,
    name,
    timestamp
  };
  if (stack !== undefined) entry.stack = stack;
  if (componentStack !== undefined) entry.componentStack = componentStack;
  if (url !== undefined) entry.url = url;

  return { entry, cycleId };
}

function sanitizeCycleBody(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const cycleId = raw.cycleId;
  if (typeof cycleId !== 'number' || !Number.isFinite(cycleId)) return null;
  return cycleId;
}

const router: IRouter = Router();

/**
 * POST /apps/:id/runtime-errors
 *
 * Auth: JWT (applied on protectedRouter) + validateAppOwnership (route).
 * Body: { message: string, name: string, cycleId: number,
 *         stack?, componentStack?, url?, timestamp? }
 * Response: always 204 (no body).
 */
router.post('/:id/runtime-errors', validateAppOwnership, (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const sanitized = sanitizePayload(req.body);
  if (!sanitized) {
    const raw = req.body as Record<string, unknown> | undefined;
    const rawCycleId = raw?.cycleId;
    // `hasCycleId` is logged separately so operators can distinguish a
    // missing-field drop (e.g. a stray caller that forgot `cycleId`) from
    // a truly malformed payload (missing `message`/`name`). Without it,
    // both paths log identically and silent drops are hard to diagnose.
    logger.warn('route.runtime-errors.invalid-payload', {
      appId: id,
      hasMessage: typeof raw?.message === 'string',
      hasName: typeof raw?.name === 'string',
      hasCycleId: typeof rawCycleId === 'number' && Number.isFinite(rawCycleId)
    });
    // Still respond 204 — preview should never be able to tell a
    // malformed payload from a well-formed one by the HTTP status.
    return res.status(204).end();
  }

  const result = runtimeErrorBuffer.push(id, sanitized.entry, sanitized.cycleId);
  logger.info('route.runtime-errors.pushed', {
    appId: id,
    result,
    errorName: sanitized.entry.name,
    messageLen: sanitized.entry.message.length,
    hasStack: sanitized.entry.stack !== undefined,
    hasComponentStack: sanitized.entry.componentStack !== undefined,
    cycleId: sanitized.cycleId,
    bufferSize: runtimeErrorBuffer.size(id)
  });

  return res.status(204).end();
});

/**
 * POST /apps/:id/runtime-errors/cycle
 *
 * Announces that the preview has entered a new render generation (HMR
 * boundary or full reload). Evicts buffered entries from earlier
 * generations so the post-stream validator only ever sees errors that
 * reflect the *currently rendering* code.
 *
 * Auth: JWT + validateAppOwnership, same as the push route.
 * Body: { cycleId: number } — monotonic per client session (typically
 *                              `Date.now()` at the moment of the HMR
 *                              beforeUpdate event).
 * Response: 204 on valid payload; 204 on invalid too (same no-leak
 *           policy as the push route).
 */
router.post(
  '/:id/runtime-errors/cycle',
  validateAppOwnership,
  (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'App ID is required' });
    }

    const cycleId = sanitizeCycleBody(req.body);
    if (cycleId === null) {
      logger.warn('route.runtime-errors.cycle.invalid-payload', { appId: id });
      return res.status(204).end();
    }

    const previous = runtimeErrorBuffer.getCurrentCycleId(id);
    runtimeErrorBuffer.rotateCycle(id, cycleId);
    const current = runtimeErrorBuffer.getCurrentCycleId(id);

    logger.info('route.runtime-errors.cycle.rotated', {
      appId: id,
      previousCycleId: previous,
      newCycleId: current,
      // `accepted` when the cycle actually moved the needle; `noop` when
      // the incoming id was stale (already advanced past it). Useful for
      // diagnosing reordered POSTs on slow networks.
      result: current !== previous ? 'accepted' : 'noop',
      bufferSize: runtimeErrorBuffer.size(id)
    });

    return res.status(204).end();
  }
);

export { router as runtimeErrorsRouter };
export default router;
