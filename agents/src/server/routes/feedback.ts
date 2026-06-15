/**
 * Feedback Routes
 *
 * POST /feedback — user-feedback channel. Emits an Event Bus user-feedback
 * event tagged against the trace produced by this agent so the feedback
 * lands on the corresponding Langfuse trace via the shared AiroHQ Event Bus
 * producer (preferred platform path per the Agent Observability Producer
 * User Guide).
 *
 * Shape aligns with the events-team user-feedback schema
 * (`urn:shared:ai:event:/agent/user-feedback/v1`). The schema is constructed
 * via `createUserFeedback({...})` from `@godaddy/agent-observability-events`,
 * and emitted via `emitUserFeedback({...})` from `@godaddy/agent-otel-sdk`.
 *
 * Mirrors the pattern at
 *   packages/ai-lib/src/budget/cost-attribution/emit-cost-attribution-result.ts:157
 *   agents/src/server/ai-lib-websocket-server.ts:2293-2308
 * but synthesizes an OTel context from client-sent IDs because HTTP handlers
 * have no active OTel context at entry (unlike WS, which does its own
 * createTraceContext upstream).
 */

import { Router, type Request, type Response } from 'express';
import { context as otelContext, trace } from '@opentelemetry/api';
import { createAgentContext, emitUserFeedback } from '@godaddy/agent-otel-sdk';
import { createUserFeedback } from '@godaddy/agent-observability-events';
import { createTraceContext } from '@signals/otel-sdk';
import { BUSINESS_CONTEXT_SCHEMA_ID } from '@airo/ai-transport';
import { z } from 'zod';

import { Logger } from '../../logging/index.js';
import { validateAppOwnershipFromBody } from '../middleware/app-ownership.js';

const logger = Logger.create({ component: 'feedback-routes' });

// OTel requires traceId to be 32 hex chars and spanId to be 16, and treats
// all-zero values as the INVALID sentinel. Anything else poisons the span
// context we seed below and breaks Langfuse correlation silently, so we
// validate here and drop malformed IDs (the feedback still emits, just
// without the trace link) rather than 400-ing the request.
const TRACE_ID_REGEX = /^[0-9a-f]{32}$/i;
const SPAN_ID_REGEX = /^[0-9a-f]{16}$/i;
const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

const EVENT_CREATION_TIMESTAMP_REGEX =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/;

function isValidTraceId(id: string | undefined): id is string {
  return typeof id === 'string' && TRACE_ID_REGEX.test(id) && id.toLowerCase() !== INVALID_TRACE_ID;
}

function isValidSpanId(id: string | undefined): id is string {
  return typeof id === 'string' && SPAN_ID_REGEX.test(id) && id.toLowerCase() !== INVALID_SPAN_ID;
}

function resolveEventCreationTimestamp(isoTimestamp: string | undefined): Date {
  if (!isoTimestamp) {
    return new Date();
  }

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    logger.warn('feedback.invalid_event_creation_timestamp', { isoTimestamp });
    return new Date();
  }

  return parsed;
}

const FeedbackRequestSchema = z.object({
  // Thumbs up/down directly — no server-side translation from a numeric value.
  feedback: z.enum(['positive', 'negative']),
  // Scope of what's being rated. Each surface decides: the app-generation
  // banner uses 'artifact' (the generated app); a chat-turn surface would
  // use 'invocation'; etc.
  targetLevel: z.enum(['conversation', 'invocation', 'artifact', 'general']),
  // Stable identifier for the rated target. For app-generation this is the
  // appId; for invocation-level feedback it's the invocationId from the
  // rated invocation; for general feedback it's the agentId.
  targetId: z.string().min(1).max(256),
  // Optional: when the complete WS event carried them, they seed an OTel
  // span context so this feedback event stitches to the rated turn's
  // Langfuse trace. When absent (e.g. OTel instrumentation not configured
  // locally) the event still emits — just without the trace link.
  traceId: z.string().min(1).max(128).optional(),
  observationId: z.string().min(1).max(128).optional(),
  appId: z.string().min(1).max(128),
  conversationId: z.string().min(1).max(128),
  eventCreationTimestamp: z.string().regex(EVENT_CREATION_TIMESTAMP_REGEX).optional(),
  rating: z.number().int().optional(),
  feedbackCategory: z.string().min(1).max(256).optional(),
  feedbackText: z.string().min(1).max(4096).optional(),
  hasDetailedFeedback: z.boolean().optional(),
});

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

const router: Router = Router();

router.post(
  '/feedback',
  validateAppOwnershipFromBody('appId'),
  async (req: Request, res: Response) => {
    const parseResult = FeedbackRequestSchema.safeParse(req.body ?? {});
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      logger.warn('feedback.validation_failed', { issues });
      return res.status(400).json({ error: 'Invalid payload', issues });
    }

    const {
      feedback,
      targetLevel,
      targetId,
      traceId,
      observationId,
      appId,
      conversationId,
      eventCreationTimestamp,
      rating,
      feedbackCategory,
      feedbackText,
      hasDetailedFeedback,
    } = parseResult.data;

    // Seed OTel context from client-sent IDs so the event stitches to the
    // existing Langfuse trace instead of creating a new one. Cost attribution
    // gets this wrap for free because it runs inside the WS handler's active
    // trace context; HTTP routes have to synthesize it. When the caller
    // didn't send IDs (no OTel active upstream) or the IDs don't match the
    // OTel format, we skip the seeding and let the event land on its own
    // trace rather than poisoning the span context.
    const validTraceId = isValidTraceId(traceId) ? traceId : undefined;
    const validSpanId = isValidSpanId(observationId) ? observationId : undefined;
    if ((traceId && !validTraceId) || (observationId && !validSpanId)) {
      logger.warn('feedback.invalid_trace_ids', {
        appId,
        traceIdProvided: !!traceId,
        traceIdValid: !!validTraceId,
        observationIdProvided: !!observationId,
        observationIdValid: !!validSpanId,
      });
    }
    const baseCtx =
      validTraceId && validSpanId
        ? trace.setSpanContext(otelContext.active(), {
            traceId: validTraceId,
            spanId: validSpanId,
            traceFlags: 1,
            isRemote: true,
          })
        : otelContext.active();

    // Build trace + signals + business context on top of the (optionally
    // seeded) span. createTraceContext reuses the active span context when
    // present (per SDK contract) instead of generating a new one, so the
    // event stitches to the client-supplied trace when one was provided.
    // businessContext attached here is inherited by emitUserFeedback —
    // matching the cost-attribution pattern where businessContext is set
    // upstream, not passed inline on the emit.
    const traceCtx = otelContext.with(baseCtx, () =>
      createTraceContext({
        headers: req.headers,
        businessContext: {
          schemaId: BUSINESS_CONTEXT_SCHEMA_ID,
          data: { appId },
        },
      }),
    );

    otelContext.with(traceCtx, () => {
      otelContext.with(
        createAgentContext({
          conversationId,
        }),
        () => {
          emitUserFeedback({
            eventData: createUserFeedback({
              targetLevel,
              targetId,
              feedback,
              eventCreationTimestamp: resolveEventCreationTimestamp(eventCreationTimestamp),
              hasDetailedFeedback: hasDetailedFeedback ?? false,
              ...(rating !== undefined && { rating }),
              ...(feedbackCategory !== undefined && { feedbackCategory }),
              ...(feedbackText !== undefined && { feedbackText }),
            }),
          });
        },
      );
    });

    logger.info('feedback.emit', {
      appId,
      feedback,
      targetLevel,
      targetId,
      traceId: validTraceId,
      observationId: validSpanId,
      conversationId,
    });

    return res.status(200).json({ success: true });
  },
);

export default router;
