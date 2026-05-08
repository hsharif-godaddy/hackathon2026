import { describe, expect, it } from 'vitest'

import {
  KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES,
  serializeInsightsFeedbackForKeepalive,
} from '../insights-feedback-keepalive-body'

function utf8Len(s: string): number {
  return new TextEncoder().encode(s).length
}

const basePayload = {
  vote: 'up' as const,
  appId: 'app-1',
  pageHostId: 'example.com',
  insightKind: 'insight',
  insightTitle: 'Title',
  insightBody: 'Body',
  partitionSnapDate: '2025-04-08',
}

describe('insights-feedback-keepalive-body', () => {
  describe('#serializeInsightsFeedbackForKeepalive', () => {
    it('returns JSON within keepalive byte budget for small payloads', () => {
      const json = serializeInsightsFeedbackForKeepalive({
        ...basePayload,
        insightRaw: { snapshot: true },
      })
      expect(utf8Len(json)).toBeLessThanOrEqual(KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES)
      expect(JSON.parse(json).insightRaw).toEqual({ snapshot: true })
    })

    it('truncates large insightRaw while staying under byte budget', () => {
      const json = serializeInsightsFeedbackForKeepalive({
        ...basePayload,
        insightRaw: { blob: 'x'.repeat(120_000) },
      })
      expect(utf8Len(json)).toBeLessThanOrEqual(KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES)
      const parsed = JSON.parse(json) as { insightRaw: { truncated?: boolean; prefix?: string } }
      expect(parsed.insightRaw.truncated).toBe(true)
      expect(typeof parsed.insightRaw.prefix).toBe('string')
      expect(parsed.insightRaw.prefix!.length).toBeGreaterThan(0)
    })

    it('drops insightRaw when titles dominate size', () => {
      const json = serializeInsightsFeedbackForKeepalive({
        ...basePayload,
        insightTitle: 't'.repeat(80_000),
        insightBody: 'd'.repeat(80_000),
        insightRaw: { ok: true },
      })
      expect(utf8Len(json)).toBeLessThanOrEqual(KEEPALIVE_INSIGHT_FEEDBACK_MAX_UTF8_BYTES)
      const parsed = JSON.parse(json) as { insightRaw: unknown; insightTitle: string; insightBody: string }
      expect(parsed.insightRaw).toBeNull()
      expect(parsed.insightTitle.endsWith('…')).toBe(true)
      expect(parsed.insightBody.endsWith('…')).toBe(true)
    })
  })
})
