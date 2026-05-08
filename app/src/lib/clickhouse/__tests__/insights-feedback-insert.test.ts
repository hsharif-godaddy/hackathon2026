import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildInsightsFeedbackRow, getClickHouseInsightsFeedbackConfig } from '../insights-feedback-insert'

function validEnv(overrides: Partial<Record<string, string>> = {}) {
  vi.stubEnv('CLICKHOUSE_HOST', overrides.CLICKHOUSE_HOST ?? 'ch.example.com')
  vi.stubEnv('CLICKHOUSE_USER', overrides.CLICKHOUSE_USER ?? 'user')
  vi.stubEnv('CLICKHOUSE_PASSWORD', overrides.CLICKHOUSE_PASSWORD ?? 'secret')
  vi.stubEnv('CLICKHOUSE_DATABASE', overrides.CLICKHOUSE_DATABASE ?? 'analytics_db')
  vi.stubEnv('CLICKHOUSE_INSIGHTS_FEEDBACK_TABLE', overrides.CLICKHOUSE_INSIGHTS_FEEDBACK_TABLE ?? 'insights_feedback')
}

describe('insights-feedback-insert', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('#getClickHouseInsightsFeedbackConfig', () => {
    it('returns null when CLICKHOUSE_HOST is missing', () => {
      validEnv()
      vi.stubEnv('CLICKHOUSE_HOST', '')
      expect(getClickHouseInsightsFeedbackConfig()).toBeNull()
    })

    it('returns null when CLICKHOUSE_USER is missing', () => {
      validEnv()
      vi.stubEnv('CLICKHOUSE_USER', '')
      expect(getClickHouseInsightsFeedbackConfig()).toBeNull()
    })

    it('returns null when database fails identifier validation', () => {
      validEnv({ CLICKHOUSE_DATABASE: '9bad' })
      expect(getClickHouseInsightsFeedbackConfig()).toBeNull()

      vi.unstubAllEnvs()
      validEnv({ CLICKHOUSE_DATABASE: 'bad-name' })
      expect(getClickHouseInsightsFeedbackConfig()).toBeNull()
    })

    it('returns null when table fails identifier validation', () => {
      validEnv({ CLICKHOUSE_INSIGHTS_FEEDBACK_TABLE: '' })
      expect(getClickHouseInsightsFeedbackConfig()).toBeNull()
    })

    it('prefixes https when host has no scheme', () => {
      validEnv({ CLICKHOUSE_HOST: 'clickhouse.internal:8443' })
      expect(getClickHouseInsightsFeedbackConfig()?.baseUrl).toBe('https://clickhouse.internal:8443')
    })

    it('preserves http and https URLs and strips one trailing slash', () => {
      validEnv({ CLICKHOUSE_HOST: 'https://ch.test/' })
      expect(getClickHouseInsightsFeedbackConfig()?.baseUrl).toBe('https://ch.test')

      vi.unstubAllEnvs()
      validEnv({ CLICKHOUSE_HOST: 'http://ch.test/' })
      expect(getClickHouseInsightsFeedbackConfig()?.baseUrl).toBe('http://ch.test')
    })

    it('uses empty string when CLICKHOUSE_PASSWORD is unset', () => {
      validEnv()
      vi.stubEnv('CLICKHOUSE_PASSWORD', '')
      expect(getClickHouseInsightsFeedbackConfig()?.password).toBe('')
    })
  })

  describe('#buildInsightsFeedbackRow', () => {
    const baseInput = {
      feedbackId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      vote: 'up',
      appId: 'app-1',
      pageHostId: 'example.com',
      insightKind: 'insight',
      insightTitle: 'T',
      insightBody: 'B',
      partitionSnapDate: '2026-04-08',
      insightRaw: { k: 1 },
      customerId: 'cust-1',
    }

    it('maps camelCase input to snake_case ClickHouse columns', () => {
      const row = buildInsightsFeedbackRow(baseInput)
      expect(row.feedback_id).toBe(baseInput.feedbackId)
      expect(row.vote).toBe('up')
      expect(row.app_id).toBe('app-1')
      expect(row.page_host_id).toBe('example.com')
      expect(row.insight_kind).toBe('insight')
      expect(row.insight_title).toBe('T')
      expect(row.insight_body).toBe('B')
      expect(row.partition_snap_date).toBe('2026-04-08')
      expect(row.customer_id).toBe('cust-1')
      expect(row.insight_raw).toBe(JSON.stringify({ k: 1 }))
    })

    it('formats submitted_at as ISO without T or trailing Z', () => {
      const submittedAt = new Date('2026-05-08T14:30:00.456Z')
      const row = buildInsightsFeedbackRow({ ...baseInput, submittedAt })
      expect(row.submitted_at).toBe('2026-05-08 14:30:00.456')
    })

    it('stores parseable JSON with truncated sentinel when serialized insight_raw exceeds limit', () => {
      const inner = 'z'.repeat(199_999)
      const json = JSON.stringify(inner)
      expect(json.length).toBeGreaterThan(200_000)
      const row = buildInsightsFeedbackRow({ ...baseInput, insightRaw: inner })
      expect(row.insight_raw.length).toBeLessThanOrEqual(200_000)
      const parsed = JSON.parse(row.insight_raw) as { truncated: boolean; prefix: string }
      expect(parsed.truncated).toBe(true)
      expect(json.startsWith(parsed.prefix)).toBe(true)
    })

    it('serializes nullish insightRaw as JSON null', () => {
      expect(buildInsightsFeedbackRow({ ...baseInput, insightRaw: null }).insight_raw).toBe('null')
      expect(buildInsightsFeedbackRow({ ...baseInput, insightRaw: undefined }).insight_raw).toBe('null')
    })

    it('stringifies non-JSON-safe values to null string when stringify throws', () => {
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const row = buildInsightsFeedbackRow({ ...baseInput, insightRaw: cyclic })
      expect(row.insight_raw).toBe('null')
    })
  })
})
