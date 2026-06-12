'use client'

import SecretsPanelContent from '@/app/[market]/develop/components/chat/secrets/SecretsPanelContent'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'

export interface SecretsComposerSurfaceProps {
  request: ActiveSecretsRequest
  conversationId?: string
}

export default function SecretsComposerSurface({
  request,
  conversationId,
}: SecretsComposerSurfaceProps) {
  return (
    <SecretsPanelContent
      conversationId={conversationId}
      request={request}
      surfaceVariant="composer"
    />
  )
}
