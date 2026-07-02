import { context as otelContext, type Context } from '@opentelemetry/api';
import { createAgentContext } from '@godaddy/agent-otel-sdk';
import { propagateAttributes } from '@langfuse/tracing';

const SPECIALIST_KEY = 'summarization';

export interface SummarizationTelemetryParams {
  appId: string;
  sessionId?: string;
  customerId?: string;
  conversationId?: string;
  siteId?: string;
}

interface LangfuseAttributes {
  userId: string;
  sessionId?: string;
  metadata: Record<string, string>;
}

/**
 * Builds Langfuse propagateAttributes and an OTel agent context for
 * summarization LLM calls. Centralizes the attribute construction that
 * all three generateText call sites (LLM, DetailedLLM, recompress) share.
 */
export function buildSummarizationTelemetry(params: SummarizationTelemetryParams): {
  attributes: LangfuseAttributes;
  agentCtx: Context;
} {
  const { appId, sessionId, customerId, conversationId, siteId } = params;

  const metadata: Record<string, string> = {};
  if (customerId) metadata.customerId = customerId;
  if (conversationId) metadata.conversationId = conversationId;
  if (siteId) metadata.siteId = siteId;
  metadata.specialistKey = SPECIALIST_KEY;

  const attributes: LangfuseAttributes = { userId: appId, metadata };
  if (sessionId) attributes.sessionId = sessionId;

  const agentCtx: Context = createAgentContext({
    conversationId,
    specialistKey: SPECIALIST_KEY,
  });

  return { attributes, agentCtx };
}

/**
 * Wraps an async function with OTel agent context and Langfuse attribute
 * propagation for summarization spans.
 */
export async function withSummarizationTelemetry<T>(
  params: SummarizationTelemetryParams,
  fn: () => Promise<T>,
): Promise<T> {
  const { attributes, agentCtx } = buildSummarizationTelemetry(params);
  return otelContext.with(agentCtx, () =>
    propagateAttributes(attributes, fn)
  );
}
