import { logger } from '../logging/index.js'
import { logoGenerationService } from '../services/logo/LogoGenerationService.js'

interface CancelSocket {
  id: string
  handshake: { auth?: { agentContext?: { siteId?: string } } }
}
type CancelAck = (response: { success?: boolean; cancelled?: boolean; error?: string }) => void

export async function handleCancelLogoGeneration(
  socket: CancelSocket,
  data: { jobId?: string } | undefined,
  ack?: CancelAck,
): Promise<void> {
  const appId = socket.handshake.auth?.agentContext?.siteId
  if (!appId) {
    logger.error('logo.cancel.no_app', { socketId: socket.id })
    ack?.({ error: 'Authentication context missing' })
    return
  }
  try {
    const result = await logoGenerationService.cancel(appId, data?.jobId)
    ack?.({ success: true, cancelled: result.cancelled })
  } catch (err) {
    logger.error('logo.cancel.handler_error', {
      appId, error: err instanceof Error ? err.message : String(err),
    })
    ack?.({ error: 'Failed to cancel logo generation' })
  }
}
