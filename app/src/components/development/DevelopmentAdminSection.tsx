'use client'

import { useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import AlertIcon from '@ux/icon/alert'
import StopIcon from '@ux/icon/stop'
import TrashIcon from '@ux/icon/trash'
import Modal from '@ux/modal'
import text from '@ux/text'

import { isFeatureEnabled } from '@/lib/features'

interface DevelopmentAdminSectionProps {
  totalItems: number
  runningItems: number
  itemType: string

  onStopAll: () => Promise<void>
  onDeleteAll: () => Promise<void>

  isStopAllLoading?: boolean
  isDeleteAllLoading?: boolean

  title?: string
  description?: string
}

type AlertType = 'stop-all' | 'delete-all' | null

export default function DevelopmentAdminSection({
  totalItems,
  runningItems,
  itemType,
  onStopAll,
  onDeleteAll,
  isStopAllLoading = false,
  isDeleteAllLoading = false,
  title = "Development Admin",
  description = "Bulk actions for development and testing"
}: DevelopmentAdminSectionProps) {
  const [alertType, setAlertType] = useState<AlertType>(null)

  if (!isFeatureEnabled.developmentMode()) {
    return null
  }

  const showStopAllAlert = () => {
    if (runningItems === 0) return
    setAlertType('stop-all')
  }

  const showDeleteAllAlert = () => {
    if (totalItems === 0) return
    setAlertType('delete-all')
  }

  const handleConfirm = async () => {
    if (alertType === 'stop-all') {
      await onStopAll()
    } else if (alertType === 'delete-all') {
      await onDeleteAll()
    }
    setAlertType(null)
  }

  const closeAlert = () => setAlertType(null)

  const isLoading = isStopAllLoading || isDeleteAllLoading
  const modalTitle = alertType === 'stop-all' ? `Stop All ${itemType}` : `Delete All ${itemType}`
  const confirmText = alertType === 'stop-all'
    ? (isStopAllLoading ? 'Stopping...' : 'Stop All')
    : (isDeleteAllLoading ? 'Deleting...' : 'Delete All')
  const alertMessage = alertType === 'stop-all'
    ? `Are you sure you want to stop all ${runningItems} running ${itemType}? This will make them inaccessible until restarted.`
    : `This will permanently delete ALL ${totalItems} ${itemType} and cannot be undone. Are you absolutely sure?`

  return (
    <>
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 py-2">
          <div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-1.5">
            <div className="flex items-center space-x-1.5">
              <AlertIcon className="w-2.5 h-2.5" />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-xs">{description}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                onClick={showStopAllAlert}
                design="secondary"
                disabled={isStopAllLoading || isDeleteAllLoading || runningItems === 0}
                size="sm"
                title={`Stop all running ${itemType}`}
                icon={<StopIcon />}
                text={`Stop All (${runningItems})`}
                data-testid="admin-stop-all-button"
              />

              <Button
                onClick={showDeleteAllAlert}
                design="critical"
                disabled={isStopAllLoading || isDeleteAllLoading || totalItems === 0}
                size="sm"
                title={`Delete all ${itemType} (DANGEROUS)`}
                icon={<TrashIcon />}
                text={`Delete All (${totalItems})`}
                data-testid="admin-delete-all-button"
              />
            </div>
          </div>
        </div>
      </div>

      {alertType && (
        <Modal
          title={modalTitle}
          onClose={closeAlert}
          portalElem={document.body}
          actions={
            <Box orientation="horizontal" gap="sm">
              <Button
                onClick={closeAlert}
                size="sm"
                disabled={isLoading}
                design="secondary"
                text="Cancel"
                data-testid={`admin-${alertType}-cancel-button`}
              />
              <Button
                onClick={handleConfirm}
                size="sm"
                disabled={isLoading}
                design="critical"
                text={confirmText}
                data-testid={`admin-${alertType}-confirm-button`}
              />
            </Box>
          }
        >
          <div className="max-w-sm">
            <text.p size={0} className="break-words">{alertMessage}</text.p>
          </div>
        </Modal>
      )}
    </>
  )
}
