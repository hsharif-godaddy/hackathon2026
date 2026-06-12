'use client'

import { useMemo } from 'react'

import CollapsibleChatInputSection from '@/app/[market]/develop/components/chat/CollapsibleChatInputSection'
import SecretsPanelContent from '@/app/[market]/develop/components/chat/secrets/SecretsPanelContent'
import { secretsPanelTitle } from '@/app/[market]/develop/components/chat/secrets/secretsPanelTitle'
import type { ActiveSecretsRequest } from '@/app/[market]/develop/components/chat/secrets/types'

export interface SecretsInputPanelProps {
  request: ActiveSecretsRequest
  conversationId?: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}

export default function SecretsInputPanel({
  request,
  conversationId,
  expanded,
  onExpandedChange,
}: SecretsInputPanelProps) {
  const panelTitle = useMemo(
    () => secretsPanelTitle(request.payload),
    [request.payload, request.secretKey],
  )

  return (
    <CollapsibleChatInputSection
      data-testid="collapsible-section-secrets-panel"
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      title={<span className="text-foreground">{panelTitle}</span>}
    >
      <div className="my-1">
        <SecretsPanelContent conversationId={conversationId} request={request} />
      </div>
    </CollapsibleChatInputSection>
  )
}
