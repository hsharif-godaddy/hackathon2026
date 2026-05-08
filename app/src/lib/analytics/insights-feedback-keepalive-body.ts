/** Keepalive POST bodies are capped (~64KiB); leave margin for headers / proxies. */
export const KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES = 55_000

export interface InsightsFeedbackTransportPayload {
  vote: 'up' | 'down' | 'none'
  appId: string | null
  pageHostId: string | null
  insightKind: string
  insightTitle: string | null
  insightBody: string | null
  partitionSnapDate: string | null
  insightRaw: unknown
}

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

function trimEnd(s: string | null, maxChars: number): string | null {
  if (s === null) return null
  return s.length <= maxChars ? s : `${s.slice(0, maxChars)}…`
}

function insightRawUnderSerializedCap(raw: unknown, maxWrappedJsonChars: number): unknown {
  if (maxWrappedJsonChars < 40) return null

  let full: string
  try {
    full = JSON.stringify(raw ?? null)
  } catch {
    return null
  }

  if (full.length <= maxWrappedJsonChars) return raw

  let low = 0
  let high = full.length
  let bestLen = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = JSON.stringify({ truncated: true, prefix: full.slice(0, mid) })
    if (candidate.length <= maxWrappedJsonChars) {
      bestLen = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return { truncated: true, prefix: full.slice(0, bestLen) }
}

function stringifyPayload(payload: InsightsFeedbackTransportPayload): string {
  return JSON.stringify({
    vote: payload.vote,
    appId: payload.appId,
    pageHostId: payload.pageHostId,
    insightKind: payload.insightKind,
    insightTitle: payload.insightTitle,
    insightBody: payload.insightBody,
    partitionSnapDate: payload.partitionSnapDate,
    insightRaw: payload.insightRaw,
  })
}

export function serializeInsightsFeedbackForKeepalive(payload: InsightsFeedbackTransportPayload): string {
  let maxRawChars = 48_000

  for (let i = 0; i < 14; i++) {
    const insightRaw = insightRawUnderSerializedCap(payload.insightRaw, maxRawChars)
    const json = stringifyPayload({ ...payload, insightRaw })
    if (utf8ByteLength(json) <= KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES) return json
    maxRawChars = Math.floor(maxRawChars / 2)
  }

  let json = stringifyPayload({ ...payload, insightRaw: null })
  if (utf8ByteLength(json) <= KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES) return json

  json = stringifyPayload({
    ...payload,
    insightRaw: null,
    insightTitle: trimEnd(payload.insightTitle, 4_000),
    insightBody: trimEnd(payload.insightBody, 8_000),
  })
  if (utf8ByteLength(json) <= KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES) return json

  return stringifyPayload({
    ...payload,
    insightRaw: null,
    insightTitle: trimEnd(payload.insightTitle, 500),
    insightBody: trimEnd(payload.insightBody, 1_000),
  })
}
