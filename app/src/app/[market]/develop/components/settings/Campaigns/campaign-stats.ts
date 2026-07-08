'use client'

import type { CampaignLeadsRow, CampaignStats } from '@/app/[market]/develop/components/settings/Campaigns/types'

export const CAMPAIGN_STATS_QUERY_KEY = 'campaign-stats'

const CAMPAIGN_STATS_ENDPOINT = '/api/marketing/campaign-stats'

/** Raw breakdown row as returned by the Customer Stats GraphQL API. */
interface RawBreakdownRow {
  key?: { source?: string; medium?: string }
  metrics?: { leads?: number }
}

/** Raw campaign metrics object as returned by the Customer Stats GraphQL API. */
export interface RawCampaignStat {
  id?: string
  totals?: { leads?: number }
  breakdown?: RawBreakdownRow[]
}

/** The single source that drove the most leads, plus its share of the campaign total. */
export interface TopLeadSourceShare {
  source: string
  percent: number
}

/**
 * Aggregate a campaign's leads by source (summing across mediums) and return the
 * top-performing source with its rounded percentage share of total leads. Returns
 * `null` when there are no leads to attribute. Powers the "X drove N% of your leads"
 * insight in the Leads Generated section.
 */
export function topLeadSourceShare(stats: CampaignStats): TopLeadSourceShare | null {
  if (stats.totalLeads <= 0 || stats.breakdown.length === 0) return null

  const leadsBySource: Map<string, number> = new Map<string, number>()
  for (const row of stats.breakdown) {
    if (!row.source) continue
    leadsBySource.set(row.source, (leadsBySource.get(row.source) ?? 0) + row.leads)
  }

  let topSource: string = ''
  let topLeads: number = 0
  for (const [source, leads] of leadsBySource) {
    if (leads > topLeads) {
      topLeads = leads
      topSource = source
    }
  }

  if (!topSource) return null

  return { source: topSource, percent: Math.round((topLeads / stats.totalLeads) * 100) }
}

/** Map one raw stats object into normalized campaign stats. */
function mapRawStat(stat: RawCampaignStat): CampaignStats {
  const breakdown: CampaignLeadsRow[] = (stat.breakdown ?? []).map((row: RawBreakdownRow): CampaignLeadsRow => ({
    source: row.key?.source ?? '',
    medium: row.key?.medium ?? '',
    leads: row.metrics?.leads ?? 0,
  }))

  return { totalLeads: stat.totals?.leads ?? 0, breakdown }
}

/**
 * Normalize the raw `campaigns` array into a map keyed by campaign ref (`id`), so a
 * single batched request can hydrate every card in the list.
 */
export function parseCampaignStatsBatch(campaigns: RawCampaignStat[]): Record<string, CampaignStats> {
  const byRef: Record<string, CampaignStats> = {}
  for (const campaign of campaigns) {
    if (typeof campaign.id === 'string' && campaign.id.length > 0) {
      byRef[campaign.id] = mapRawStat(campaign)
    }
  }
  return byRef
}

/**
 * Fetch normalized performance stats for many campaigns in one request. Returns a map
 * keyed by campaign ref so each list card can look up its own leads.
 */
export async function fetchCampaignStatsList(
  appId: string,
  campaignRefIds: string[],
): Promise<Record<string, CampaignStats>> {
  const response: Response = await fetch(CAMPAIGN_STATS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId, campaignRefIds }),
  })

  if (!response.ok) throw new Error('Failed to load campaign stats')

  const data = await response.json() as { campaigns?: RawCampaignStat[] }
  return parseCampaignStatsBatch(data.campaigns ?? [])
}
