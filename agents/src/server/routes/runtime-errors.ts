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

function sanitizePayload(body: unknown): RuntimeErrorEntry | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;

  const message = clamp(raw.message, MAX_MESSAGE_LEN);
  const name = clamp(raw.name, MAX_NAME_LEN);
  if (!message || !name) return null;

  const stack = clamp(raw.stack, MAX_STACK_LEN);
  const componentStack = clamp(raw.componentStack, MAX_COMPONENT_STACK_LEN);
  const url = clamp(raw.url, MAX_URL_LEN);

  // Always stamp server-side. A client-supplied `timestamp` is ignored
  // on purpose: the buffer's `pushedAt` (set in `RuntimeErrorBuffer.push`)
  // is what `drainForTurn`'s `since` filter compares against, and any
  // separate client wall-clock value would only give us a second,
  // untrusted, non-monotonic time source to confuse ourselves with.
  const timestamp = Date.now();

  const entry: RuntimeErrorEntry = {
    message,
    name,
    timestamp
  };
  if (stack !== undefined) entry.stack = stack;
  if (componentStack !== undefined) entry.componentStack = componentStack;
  if (url !== undefined) entry.url = url;
  return entry;
}

const router: IRouter = Router();

/**
 * POST /apps/:id/runtime-errors
 *
 * Auth: JWT (applied on protectedRouter) + validateAppOwnership (route).
 * Body: { message: string, name: string, stack?, componentStack?, url?, timestamp? }
 * Response: always 204 (no body).
 */
router.post('/:id/runtime-errors', validateAppOwnership, (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'App ID is required' });
  }

  const entry = sanitizePayload(req.body);
  if (!entry) {
    logger.warn('route.runtime-errors.invalid-payload', {
      appId: id,
      hasMessage: typeof (req.body as Record<string, unknown> | undefined)?.message === 'string',
      hasName: typeof (req.body as Record<string, unknown> | undefined)?.name === 'string'
    });
    // Still respond 204 — preview should never be able to tell a
    // malformed payload from a well-formed one by the HTTP status.
    return res.status(204).end();
  }

  const result = runtimeErrorBuffer.push(id, entry);
  logger.info('route.runtime-errors.pushed', {
    appId: id,
    result,
    errorName: entry.name,
    messageLen: entry.message.length,
    hasStack: entry.stack !== undefined,
    hasComponentStack: entry.componentStack !== undefined,
    bufferSize: runtimeErrorBuffer.size(id)
  });

  return res.status(204).end();
});

export { router as runtimeErrorsRouter };
export default router;
