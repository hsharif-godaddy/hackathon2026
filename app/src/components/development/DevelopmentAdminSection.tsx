'use client'

import { useState } from 'react'
import {
  StopIcon,
  TrashIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline'
import { isFeatureEnabled } from '@/lib/features'
import Button from '@ux/button'

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
    if (runningItems === 0) return

    setAlert({
      type: 'stop-all',
      message: `Are you sure you want to stop all ${runningItems} running ${itemType}? This will make them inaccessible until restarted.`
    })
  }

  const showDeleteAllAlert = () => {
    if (totalItems === 0) return

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
      <div className="rounded-lg shadow-xl max-w-md w-full mx-4 p-6 bg-intents-ux-box-backgroundColor">
        <div className="flex items-center mb-4 gap-2">
          <ExclamationTriangleIcon className="size-6" />
          <h3 className="text-lg font-semibold">
            {type === 'stop-all' ? `Stop All ${itemType}` : `Delete All ${itemType}`}
          </h3>
        </div>
        <p className="text-sm mb-6">{message}</p>
        <div className="flex gap-2">
          <Button
            onClick={handleConfirm}
            disabled={isStopAllLoading || isDeleteAllLoading}
            design="critical"
            text={(type === 'stop-all' && isStopAllLoading) || (type === 'delete-all' && isDeleteAllLoading) ?
              (type === 'stop-all' ? 'Stopping...' : 'Deleting...') :
              (type === 'stop-all' ? 'Stop All' : 'Delete All')
            }
          />
          <Button
            onClick={clearAlert}
            disabled={isStopAllLoading || isDeleteAllLoading}
            design="tertiary"
            text="Cancel"
          />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-start md:items-center justify-between flex-col md:flex-row gap-3">
            <div className="flex items-center space-x-3">
              <ExclamationTriangleIcon className="w-5 h-5" />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-xs">{description}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={showStopAllAlert}
                design="secondary"
                disabled={isStopAllLoading || isDeleteAllLoading || runningItems === 0}
                className="px-3 py-2 rounded-lg transition-all flex items-center space-x-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Stop all running ${itemType}`}
                text={`Stop All (${runningItems})`}
                icon={<StopIcon className="w-4 h-4" />}
              />

              <Button
                onClick={showDeleteAllAlert}
                design="critical"
                disabled={isStopAllLoading || isDeleteAllLoading || totalItems === 0}
                className="px-3 py-2 rounded-lg transition-all flex items-center space-x-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Delete all ${itemType} (DANGEROUS)`}
                text={`Delete All (${totalItems})`}
                icon={<TrashIcon className="w-4 h-4" />}
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
