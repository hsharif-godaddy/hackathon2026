'use client'

import { useState } from 'react'
import {
  ExclamationTriangleIcon,
  StopIcon,
  TrashIcon} from '@heroicons/react/24/outline'
import Button from '@ux/button'

import { isFeatureEnabled } from '@/lib/features'

interface DevelopmentAdminSectionProps {
  // Counts for display
  totalItems: number
  runningItems: number
  itemType: string // e.g., "sites", "apps"

  // Actions
  onStopAll: () => Promise<void>
  onDeleteAll: () => Promise<void>

  // Loading states
  isStopAllLoading?: boolean
  isDeleteAllLoading?: boolean

  // Additional configuration
  title?: string
  description?: string
}

interface AdminAlert {
  type: 'stop-all' | 'delete-all' | null
  message: string
}

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
  const [alert, setAlert] = useState<AdminAlert>({ type: null, message: '' })

  // Don't render anything if not in development mode
  if (!isFeatureEnabled.developmentMode()) {
    return null
  }

  const showStopAllAlert = () => {
    if (runningItems === 0) {return}

    setAlert({
      type: 'stop-all',
      message: `Are you sure you want to stop all ${runningItems} running ${itemType}? This will make them inaccessible until restarted.`
    })
  }

  const showDeleteAllAlert = () => {
    if (totalItems === 0) {return}

    setAlert({
      type: 'delete-all',
      message: `This will permanently delete ALL ${totalItems} ${itemType} and cannot be undone. Are you absolutely sure?`
    })
  }

  const handleConfirm = async () => {
    if (alert.type === 'stop-all') {
      await onStopAll()
    } else if (alert.type === 'delete-all') {
      await onDeleteAll()
    }
    setAlert({ type: null, message: '' })
  }

  const clearAlert = () => {
    setAlert({ type: null, message: '' })
  }

  const AdminAlert = ({ type, message }: { type: 'stop-all' | 'delete-all', message: string }) => (
    <div className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50 bg-intents-ux-boxHighContrastOverlay-backgroundColor">
      <div className="rounded-lg shadow-xl max-w-md w-full mx-2 p-3 bg-intents-ux-box-backgroundColor">
        <div className="flex items-center mb-2 gap-1">
          <ExclamationTriangleIcon className="size-3" />
          <h3 className="text-lg font-semibold">
            {type === 'stop-all' ? `Stop All ${itemType}` : `Delete All ${itemType}`}
          </h3>
        </div>
        <p className="text-sm mb-3">{message}</p>
        <div className="flex gap-1">
          <Button
            onClick={handleConfirm}
            disabled={isStopAllLoading || isDeleteAllLoading}
            design="critical"
            text={(type === 'stop-all' && isStopAllLoading) || (type === 'delete-all' && isDeleteAllLoading) ?
              (type === 'stop-all' ? 'Stopping...' : 'Deleting...') :
              (type === 'stop-all' ? 'Stop All' : 'Delete All')
            }
            data-testid={`admin-${type}-confirm-button`}
          />
          <Button
            onClick={clearAlert}
            disabled={isStopAllLoading || isDeleteAllLoading}
            design="tertiary"
            text="Cancel"
            data-testid={`admin-${type}-cancel-button`}
          />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-2 sm:px-3 lg:px-4 py-2">
          <div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-1.5">
            <div className="flex items-center space-x-1.5">
              <ExclamationTriangleIcon className="w-2.5 h-2.5" />
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

      {/* Alert Modals */}
      {alert.type && (
        <AdminAlert
          type={alert.type}
          message={alert.message}
        />
      )}
    </>
  )
}
