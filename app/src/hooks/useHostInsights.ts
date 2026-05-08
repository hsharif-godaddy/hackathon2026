'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { pageHostFromUrl } from '@/lib/analytics/page-host-from-url'
import { executeGraphQLQuery } from '@/lib/insights/client'
import { escapeGraphQL } from '@/lib/insights/queries'
import type { InsightKind } from '@/types/analytics'

export interface HostInsightItem {
  kind: InsightKind
  value: string
}

interface HostInsightsResult {
  date: string | null
  items: HostInsightItem[]
  raw: unknown
}

interface UseHostInsightsOptions {
  publishedUrl: string | null
  appId?: string | null
  enabled?: boolean
}

interface HostInsightsResponse {
  data?: {
    page_host_insight?: {
      brand?: {
        namespace?: {
          partition_snap_utc_date?: string
          page_host_insight_array?: string[]
          page_host_recommend_array?: string[]
        }
      }
    }
  }
  errors?: Array<{ message: string }>
}

function decodeValue(raw: string): string {
  const trimmed = raw.trim()
  try {
    // API frequently returns nested JSON-escaped strings like "\"[high] ...\""
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'string') return parsed
  } catch {
    // ignore
  }
  return trimmed.replace(/^"+|"+$/g, '')
}

function buildQuery(pageHostId: string): string {
  const safeHost = escapeGraphQL(pageHostId)
  return `
query Page_host_insight {
  page_host_insight(filter: { page_host_id: "${safeHost}" }) {
    brand(brand: "godaddy") {
      namespace(namespace: "experimental") {
        page_host_id
        brand
        namespace
        partition_snap_utc_date
        page_host_insight_array
        page_host_recommend_array
      }
    }
  }
}`.trim()
}

async function fetchHostInsights(publishedUrl: string, appId?: string): Promise<HostInsightsResult> {
  const pageHostId = pageHostFromUrl(publishedUrl)
  const result = (await executeGraphQLQuery(
    buildQuery(pageHostId),
    'Page_host_insight',
    appId,
  )) as HostInsightsResponse
  const ns = result.data?.page_host_insight?.brand?.namespace
  const insights = (ns?.page_host_insight_array ?? []).map((v) => decodeValue(v))
  const recs = (ns?.page_host_recommend_array ?? []).map((v) => decodeValue(v))

  return {
    date: ns?.partition_snap_utc_date ?? null,
    items: [
      ...insights.map((value) => ({ kind: 'insight' as const, value })),
      ...recs.map((value) => ({ kind: 'recommendation' as const, value })),
    ],
    raw: result,
  }
}

export function useHostInsights({ publishedUrl, appId, enabled = true }: UseHostInsightsOptions) {
  const isEnabled = enabled && !!publishedUrl?.trim()

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['host-insights', publishedUrl, appId],
    queryFn: () => fetchHostInsights(publishedUrl!, appId ?? undefined),
    enabled: isEnabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })

  return useMemo(() => ({
    date: data?.date ?? null,
    items: data?.items ?? [],
    raw: data?.raw ?? null,
    isLoading,
    isRefreshing: !isLoading && isFetching,
    error: error ?? null,
  }), [data, isLoading, isFetching, error])
}
