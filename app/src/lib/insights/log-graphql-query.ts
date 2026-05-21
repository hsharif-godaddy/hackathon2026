import { logger } from '@/lib/request-context'

const MAX_LOGGED_ROWS = 50

export function insightNameFromQuery(query: string): string {
  return query.match(/insightName:\s*"([^"]+)"/)?.[1] ?? 'unknown'
}

function filterFieldsFromQuery(query: string): Record<string, string | number> {
  if (!query) return {}

  const fields: Record<string, string | number> = {}
  const url = query.match(/url:\s*"([^"]*)"/)?.[1]?.trim()
  if (url) fields.url = url

  const days = query.match(/\bdays:\s*(\d+)/)?.[1]
  if (days !== undefined) fields.days = Number(days)

  const fromDate = query.match(/fromDate:\s*"([^"]*)"/)?.[1]?.trim()
  if (fromDate) fields.fromDate = fromDate

  const toDate = query.match(/toDate:\s*"([^"]*)"/)?.[1]?.trim()
  if (toDate) fields.toDate = toDate

  const bucketDays = query.match(/bucketDays:\s*(\d+)/)?.[1]
  if (bucketDays !== undefined) fields.bucketDays = Number(bucketDays)

  const recordType = query.match(/recordType:\s*"([^"]*)"/)?.[1]?.trim()
  if (recordType) fields.recordType = recordType

  return fields
}

function parseAnalyticsRows(payload: unknown): Record<string, unknown>[] | null {
  if (payload === null || typeof payload !== 'object') return null
  const rows = (payload as { data?: { analyticsQuery?: { rows?: Array<{ data?: string }> } } })
    .data?.analyticsQuery?.rows
  if (!Array.isArray(rows)) return null
  return rows.map((row) => {
    if (typeof row?.data !== 'string') return { data: row?.data }
    try {
      return JSON.parse(row.data) as Record<string, unknown>
    } catch {
      return { data: row.data }
    }
  })
}

export function summarizeGraphqlResponse(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') {
    return { raw: payload }
  }
  const root = payload as { errors?: unknown[]; data?: Record<string, unknown> }
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    return {
      errorCount: root.errors.length,
      errors: root.errors,
    }
  }
  const parsedRows = parseAnalyticsRows(payload)
  if (parsedRows) {
    const truncated = parsedRows.length > MAX_LOGGED_ROWS
    return {
      rowCount: parsedRows.length,
      rows: truncated ? parsedRows.slice(0, MAX_LOGGED_ROWS) : parsedRows,
      ...(truncated ? { rowsTruncated: true } : {}),
    }
  }
  if (root.data) {
    return { dataKeys: Object.keys(root.data) }
  }
  return {}
}

/** Server-side: log outgoing analytics GraphQL request (Katana / BFF logs). */
export function logGraphqlRequest(appId: string, query: string): void {
  logger.info('analytics.graphql.request', {
    appId,
    insightName: insightNameFromQuery(query),
    queryLength: query.length,
    ...filterFieldsFromQuery(query),
  })
}

/** Server-side: log analytics GraphQL response (Katana / BFF logs). */
export function logGraphqlResponse(appId: string, query: string, payload: unknown): void {
  logger.info('analytics.graphql.response', {
    appId,
    insightName: insightNameFromQuery(query),
    ...summarizeGraphqlResponse(payload),
  })
}
