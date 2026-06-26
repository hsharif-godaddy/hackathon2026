/**
 * /commander/[id] route — scaffold for the redesigned builder UI (epic AIROBUILD-2221).
 *
 * Import, don't copy. Files under app/src/app/[market]/commander/ must contain
 * only what diverges from /develop. Anything unchanged is imported from
 * /develop so periodic rebases against main only have to merge real divergence.
 *
 * This page is a thin server-component wrapper that gates access by the
 * `appbuilder-commander` Switchboard flag. When the flag is off (or lookup
 * fails), it redirects to the equivalent /develop URL preserving search params.
 * When the flag is on, it renders the existing /develop client page unchanged
 * so subsequent tickets in the epic can layer the redesign on top.
 */

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { BuilderLayout } from '@/app/[market]/commander/types'
import DevelopPage from '@/app/[market]/develop/[id]/page'
import { SWITCHBOARD_APPBUILDER_COMMANDER } from '@/config/switchboard-flags'
import { logger } from '@/lib/request-context'
import { checkSwitchboardFlag } from '@/lib/switchboard/server'

interface CommanderPageProps {
  params: Promise<{ market: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function buildDevelopUrl(
  id: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const v of value) query.append(key, v)
    } else {
      query.append(key, value)
    }
  }
  const qs = query.toString()
  return `/develop/${id}${qs ? `?${qs}` : ''}`
}

export default async function CommanderPage(props: CommanderPageProps) {
  const reqHeaders = await headers()

  let enabled = false
  try {
    enabled = await checkSwitchboardFlag(SWITCHBOARD_APPBUILDER_COMMANDER, { headers: reqHeaders })
  } catch (error) {
    logger.warn('commander.flag.lookup-failed', {
      flag: SWITCHBOARD_APPBUILDER_COMMANDER,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  if (!enabled) {
    const { id } = await props.params
    const searchParams = await props.searchParams
    redirect(buildDevelopUrl(id, searchParams))
  }

  return <DevelopPage layout={BuilderLayout.Commander} />
}
