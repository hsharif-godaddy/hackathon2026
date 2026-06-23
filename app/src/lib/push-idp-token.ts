import { getSwitchboardFlag } from '@/hooks/useSwitchboard'
import { logger } from '@/lib/request-context'

export async function pushIdpToken(appId: string, conversationId: string): Promise<void> {
  if (getSwitchboardFlag('airo-builder-care-agent-enabled') !== true) return
  let res: Response
  try {
    res = await fetch('/api/auth/idp-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, conversationId }),
    })
  } catch (err) {
    logger.warn('care.idp_token_push.error', {
      appId,
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  if (!res.ok) {
    logger.warn('care.idp_token_push.failed', { appId, conversationId, status: res.status })
  }
}
