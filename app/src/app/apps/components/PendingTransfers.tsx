'use client'

import { useCallback, useEffect, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import CopyIcon from '@ux/icon/copy'
import Spinner from '@ux/spinner'
import Tag from '@ux/tag'
import text from '@ux/text'

import { useTranslations } from '@/hooks/useTranslations'
import { appFetch, AuthDismissedError } from '@/lib/gasket-config'
import { logger } from '@/lib/request-context'
import { useSitesStore } from '@/stores/useSitesStore'
import { formatDate } from '@/utils/common'
import { generateClickEID } from '@/utils/instrumentation'

interface TransferRecord {
  id: string
  appId: string
  transferToken: string
  status: string
  sourceCustomerId: string
  targetCustomerId: string
  createdAt: string
  expiresAt: string
  updatedAt: string
}

interface TransferListResponse {
  transfers: TransferRecord[]
  total: number
  limit: number
  offset: number
}

interface PendingTransfersProps {
  onAcceptTransfer?: () => void
}

export default function PendingTransfers({ onAcceptTransfer }: PendingTransfersProps) {
  const t = useTranslations()
  const sites = useSitesStore((state) => state.allSites)
  const refreshSites = useSitesStore((state) => state.refreshSites)
  const [outgoing, setOutgoing] = useState<TransferRecord[]>([])
  const [incoming, setIncoming] = useState<TransferRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [outgoingError, setOutgoingError] = useState(false)
  const [incomingError, setIncomingError] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelErrorId, setCancelErrorId] = useState<string | null>(null)

  const getAppName = useCallback(function resolve(appId: string) {
    return sites?.find(function match(s) { return s.id === appId })?.name
  }, [sites])

  const fetchTransfers = useCallback(async (signal?: AbortSignal) => {
    try {
      setOutgoingError(false)
      setIncomingError(false)
      const [outgoingRes, incomingRes] = await Promise.all([
        appFetch('/api/transfer?status=initiated', { signal }),
        appFetch('/api/transfer?direction=incoming&status=initiated', { signal }),
      ])

      if (outgoingRes.ok) {
        const data: TransferListResponse = await outgoingRes.json()
        setOutgoing(data.transfers || [])
      } else {
        setOutgoingError(true)
      }

      if (incomingRes.ok) {
        const data: TransferListResponse = await incomingRes.json()
        setIncoming(data.transfers || [])
      } else {
        setIncomingError(true)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      logger.error('transfer.fetch.error', {
        error: error instanceof Error ? error.message : String(error)
      })
      setOutgoingError(true)
      setIncomingError(true)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(function load() {
    const controller = new AbortController()
    fetchTransfers(controller.signal)
    return () => controller.abort()
  }, [fetchTransfers])

  const handleCopy = async (transfer: TransferRecord) => {
    try {
      await navigator.clipboard.writeText(transfer.transferToken)
      setCopiedId(transfer.id)
      setCopyFailedId(null)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      setCopyFailedId(transfer.id)
      setTimeout(() => setCopyFailedId(null), 3000)
    }
  }

  const handleCancel = async (transfer: TransferRecord) => {
    setCancellingId(transfer.id)
    setCancelErrorId(null)
    try {
      const response = await appFetch(`/api/apps/${transfer.appId}/transfer/cancel`, { method: 'POST' }, { authLevel: 3 })
      if (response.ok) {
        setOutgoing(function removeTransfer(prev) {
          return prev.filter(function keep(t) { return t.id !== transfer.id })
        })
        refreshSites()
      } else {
        const data = await response.json()
        logger.error('transfer.cancel.list.failed', { transferId: transfer.id, error: data })
        setCancelErrorId(transfer.id)
      }
    } catch (error) {
      if (error instanceof AuthDismissedError) return
      logger.error('transfer.cancel.list.error', {
        transferId: transfer.id,
        error: error instanceof Error ? error.message : String(error)
      })
      setCancelErrorId(transfer.id)
    } finally {
      setCancellingId(null)
    }
  }

  function copyButtonText(transfer: TransferRecord) {
    if (copiedId === transfer.id) return t('builder_transfer_token_copied', undefined, 'Copied!')
    if (copyFailedId === transfer.id) return t('builder_common_error', undefined, 'Error')
    return t('builder_transfer_copy_code', undefined, 'Copy Code')
  }

  if (isLoading) {
    return (
      <Box className="flex justify-center py-4">
        <Spinner size="sm" />
      </Box>
    )
  }

  const hasContent = outgoing.length > 0 || incoming.length > 0 || outgoingError || incomingError
  if (!hasContent) {
    return null
  }

  return (
    <div className="mb-6 space-y-6">
      {incomingError && (
        <div className="bg-intents-ux-criticalBox-backgroundColor border border-intents-ux-criticalBox-borderColor rounded-lg p-3 text-center">
          <text.p size={-1} emphasis="critical">
            {t('builder_transfer_error_incoming_fetch', undefined, 'Failed to load incoming transfers.')}
          </text.p>
        </div>
      )}

      {incoming.length > 0 && (
        <div data-testid="incoming-transfers">
          <Box orientation="horizontal" gap="md" className="mb-3 items-center">
            <text.p size={1} className="font-semibold">
              {t('builder_transfer_incoming_title', undefined, 'Incoming Transfers')}
            </text.p>
            <Tag emphasis="info">{String(incoming.length)}</Tag>
          </Box>

          <div className="space-y-2">
            {incoming.map(function renderIncoming(transfer) {
              return (
                <div
                  key={transfer.id}
                  className="border border-intents-ux-box-borderColor rounded-lg p-3 bg-intents-ux-box-backgroundColor"
                >
                  <Box orientation="horizontal" className="justify-between items-center">
                    <Box orientation="vertical" gap="sm">
                      <Box orientation="horizontal" gap="sm" className="items-center">
                        <text.span size={0} className="font-medium">
                          {getAppName(transfer.appId) || transfer.appId}
                        </text.span>
                        <Tag emphasis="info" size="sm">{t('builder_transfer_status_pending_accept', undefined, 'Pending Acceptance')}</Tag>
                      </Box>
                      <text.span size={-1} emphasis="passive">
                        {t('builder_transfer_incoming_expires', { date: formatDate(transfer.expiresAt) }, 'Expires {date}')}
                      </text.span>
                    </Box>
                    <Button
                      onClick={onAcceptTransfer}
                      design="primary"
                      size="sm"
                      text={t('builder_transfer_accept_button', undefined, 'Accept Transfer')}
                      data-eid={generateClickEID('apps.transfer.incoming_accept')}
                    />
                  </Box>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {outgoingError && (
        <div className="bg-intents-ux-criticalBox-backgroundColor border border-intents-ux-criticalBox-borderColor rounded-lg p-3 text-center">
          <text.p size={-1} emphasis="critical">
            {t('builder_transfer_error_outgoing_fetch', undefined, 'Failed to load outgoing transfers.')}
          </text.p>
        </div>
      )}

      {outgoing.length > 0 && (
        <div data-testid="outgoing-transfers">
          <Box orientation="horizontal" gap="md" className="mb-3 items-center">
            <text.p size={1} className="font-semibold">
              {t('builder_transfer_outgoing_title', undefined, 'Outgoing Transfers')}
            </text.p>
            <Tag emphasis="info">{String(outgoing.length)}</Tag>
          </Box>

          <div className="space-y-2">
            {outgoing.map(function renderOutgoing(transfer) {
              return (
                <div
                  key={transfer.id}
                  className="border border-intents-ux-box-borderColor rounded-lg p-3 bg-intents-ux-box-backgroundColor"
                >
                  <Box orientation="vertical" gap="sm">
                    <Box orientation="horizontal" className="justify-between items-center">
                      <Box orientation="vertical" gap="sm">
                        <Box orientation="horizontal" gap="sm" className="items-center">
                          <text.span size={0} className="font-medium">
                            {getAppName(transfer.appId) || transfer.appId}
                          </text.span>
                          <Tag emphasis="info" size="sm">{t('builder_transfer_status_initiated', undefined, 'Initiated')}</Tag>
                        </Box>
                        <text.span size={-1} emphasis="passive">
                          {t('builder_transfer_outgoing_expires', { date: formatDate(transfer.expiresAt) }, 'Expires {date}')}
                        </text.span>
                      </Box>
                      <Box orientation="horizontal" gap="sm">
                        <Button
                          onClick={() => handleCopy(transfer)}
                          design="secondary"
                          size="sm"
                          icon={<CopyIcon />}
                          text={copyButtonText(transfer)}
                          data-eid={generateClickEID('apps.transfer.outgoing_copy')}
                        />
                        <Button
                          onClick={() => handleCancel(transfer)}
                          disabled={cancellingId === transfer.id}
                          design="critical"
                          size="sm"
                          text={cancellingId === transfer.id ? t('builder_transfer_cancelling', undefined, 'Cancelling...') : t('builder_common_cancel', undefined, 'Cancel')}
                          data-eid={generateClickEID('apps.transfer.outgoing_cancel')}
                        />
                      </Box>
                    </Box>
                    {cancelErrorId === transfer.id && (
                      <text.span size={-1} emphasis="critical">
                        {t('builder_transfer_error_cancel_failed', undefined, 'Failed to cancel transfer. Please try again.')}
                      </text.span>
                    )}
                  </Box>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
