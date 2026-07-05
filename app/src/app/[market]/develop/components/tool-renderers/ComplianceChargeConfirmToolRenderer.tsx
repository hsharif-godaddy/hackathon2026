'use client'

import { useState } from 'react'
import Button from '@ux/button'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { buildDynamicApiUrl } from '@/config/dynamic-api'
import { useTranslations } from '@/hooks/useTranslations'
import { agentFetch } from '@/lib/agent-fetch'
import { type ChatMessage,useCurrentAppId, useIsActivelyStreaming, useIsLoading, useMessages } from '@/stores/useStreamingConversationStore'

interface ComplianceChargeConfirmData {
  documentType: string
  cost: number
  showCost: boolean
}

type ChargeDecision = 'accept' | 'cancel'

// Lowercase labels for the action messages sent to the agent (model-facing, not
// display copy — kept English so the history classifier + agent stay in sync).
const DOC_LABELS: Record<string, string> = {
  'privacy-policy': 'privacy policy',
  'terms-of-use': 'terms of use',
}

// Title-case document names for display. Legal compliance docs are English-only,
// so these stay English constants (not i18n) — see PR discussion.
const DOC_DISPLAY_NAMES: Record<string, string> = {
  'privacy-policy': 'Privacy Policy',
  'terms-of-use': 'Terms of Use',
}

// The exact action-message text for each decision. Shared by the click handlers
// (what we send) and the history classifier (what we recognize on reload) — the
// user-message content is persisted, so it survives where local state does not.
function acceptMessageFor(docLabel: string): string {
  return `I accept the charge. Please generate the ${docLabel}.`
}
function cancelMessageFor(docLabel: string): string {
  // Phrased as a one-time decision, not a standing "never generate" rule, so it
  // doesn't bias the model into refusing a later fresh request for the document.
  return `Let's skip the ${docLabel} for now.`
}

/**
 * Recover the decision from history, scoped to THIS tool call: find the response
 * that follows this specific invocation (by toolId). Scoping is essential — the
 * accept/cancel text repeats across invocations, so an unscoped scan would match
 * a PRIOR decision and make a fresh prompt render as already-resolved.
 */
function decisionAfterToolCall(
  messages: ChatMessage[],
  toolId: string | undefined,
  acceptMessage: string,
  cancelMessage: string,
): ChargeDecision | null {
  if (!toolId) return null
  const toolIndex: number = messages.findIndex(m => m.toolCalls?.some(tc => tc.id === toolId))
  if (toolIndex < 0) return null
  for (let i = toolIndex + 1; i < messages.length; i++) {
    const m: ChatMessage = messages[i]
    if (m.role !== 'user') continue
    if (m.content === acceptMessage) return 'accept'
    if (m.content === cancelMessage) return 'cancel'
  }
  return null
}

export default function ComplianceChargeConfirmToolRenderer({
  toolStatus,
  result,
  isLastAssistantMessage,
  toolId,
}: DefaultToolRendererProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const currentAppId = useCurrentAppId()
  const messages = useMessages()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const [decided, setDecided] = useState<ChargeDecision | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [failed, setFailed] = useState<boolean>(false)

  if (toolStatus !== 'completed' || !result) {
    return null
  }

  const resultObj = result as Record<string, unknown>
  const output = (resultObj.output ?? resultObj) as { widgetData?: ComplianceChargeConfirmData }
  const widgetData = output?.widgetData
  if (!widgetData?.documentType) {
    return null
  }

  const documentType: string = widgetData.documentType
  const docLabel: string = DOC_LABELS[documentType] ?? 'compliance document'
  const documentName: string = DOC_DISPLAY_NAMES[documentType] ?? 'compliance document'
  const acceptMessage: string = acceptMessageFor(docLabel)
  const cancelMessage: string = cancelMessageFor(docLabel)

  const chargeMessage: string = widgetData.showCost
    ? t(
        'builder_compliance_charge_message',
        { documentName, creditCount: widgetData.cost },
        'Generating the {documentName} incurs an additional charge of {creditCount, plural, one {# credit} other {# credits}}.',
      )
    : t(
        'builder_compliance_charge_message_hidden',
        { documentName },
        'Generating the {documentName} incurs an additional charge.',
      )

  // Resolved state survives reload: prefer the just-clicked local decision, else
  // recover it from the response that followed THIS invocation in history.
  const resolvedDecision: ChargeDecision | null =
    decided ?? decisionAfterToolCall(messages, toolId, acceptMessage, cancelMessage)

  const interactive: boolean = isLastAssistantMessage === true && resolvedDecision === null && !isProcessing

  async function handleAccept(): Promise<void> {
    if (!sendUserMessage || !currentAppId || submitting) return
    setSubmitting(true)
    setFailed(false)
    try {
      const url: string = await buildDynamicApiUrl('compliance/confirm', currentAppId)
      const res: Response = await agentFetch(url, {
        method: 'POST',
        siteId: currentAppId,
        body: JSON.stringify({ documentType }),
      })
      if (!res.ok) {
        setFailed(true)
        setSubmitting(false)
        return
      }
    } catch {
      setFailed(true)
      setSubmitting(false)
      return
    }
    setDecided('accept')
    sendUserMessage(acceptMessage, { isActionRequest: true })
  }

  function handleCancel(): void {
    if (!sendUserMessage || submitting) return
    setDecided('cancel')
    sendUserMessage(cancelMessage, { isActionRequest: true })
  }

  return (
    <div className="my-2 flex flex-col gap-2" data-testid="compliance-charge-confirm">
      <div className="text-sm leading-relaxed break-words">{chargeMessage}</div>
      {resolvedDecision ? (
        <div
          className="text-sm text-intents-ux-feedbackHighContrastPassive-feedbackColor"
          data-testid={`compliance-charge-${resolvedDecision === 'accept' ? 'accepted' : 'cancelled'}`}
        >
          {resolvedDecision === 'accept'
            ? t('builder_compliance_charge_accepted', undefined, 'Accepted')
            : t('builder_compliance_charge_cancelled', undefined, 'Cancelled')}
        </div>
      ) : (
        <>
          <div className="text-xs italic leading-relaxed break-words text-intents-ux-feedbackHighContrastPassive-feedbackColor">
            {t('builder_compliance_charge_submessage', undefined, 'Edits to this document do not incur any additional charges.')}
          </div>
          {failed ? (
            <div className="text-sm text-intents-ux-feedbackHighContrastCritical-feedbackColor">
              {t('builder_compliance_charge_confirm_error', undefined, 'Could not record your confirmation. Please try again.')}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              text={t('builder_compliance_charge_accept', undefined, 'Accept')}
              design="primary"
              size="sm"
              disabled={!interactive || submitting}
              onClick={handleAccept}
              data-testid="compliance-charge-accept"
            />
            <Button
              text={t('builder_compliance_charge_cancel', undefined, 'Cancel')}
              design="secondary"
              size="sm"
              disabled={!interactive || submitting}
              onClick={handleCancel}
              data-testid="compliance-charge-cancel"
            />
          </div>
        </>
      )}
    </div>
  )
}
