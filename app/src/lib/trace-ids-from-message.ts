export interface MessageTraceContext {
  traceId?: string;
  observationId?: string;
  agentName?: string;
}

interface MessageWithMetadata {
  metadata?: {
    traceId?: string;
    observationId?: string;
    agentId?: string;
  };
}

/** OTel + agent context from a completed assistant message (same source as ResponseMetadata). */
export function traceIdsFromMessage(message: MessageWithMetadata): MessageTraceContext | null {
  const meta = message.metadata;
  if (!meta) return null;

  const traceId = typeof meta.traceId === 'string' ? meta.traceId : undefined;
  const observationId =
    typeof meta.observationId === 'string' ? meta.observationId : undefined;
  const agentName = typeof meta.agentId === 'string' ? meta.agentId : undefined;

  if (!traceId && !observationId && !agentName) return null;

  return {
    ...(traceId && { traceId }),
    ...(observationId && { observationId }),
    ...(agentName && { agentName }),
  };
}
