'use client'

import { useState } from 'react'
import { 
  StopIcon, 
  TrashIcon, 
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline'
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
    if (runningItems === 0) return
    
    setAlert({
      type: 'stop-all',
      message: `Are you sure you want to stop all ${runningItems} running ${itemType}${runningItems === 1 ? '' : 's'}? This will make them inaccessible until restarted.`
    })
  }

  const showDeleteAllAlert = () => {
    if (totalItems === 0) return
    
    setAlert({
      type: 'delete-all', 
      message: `⚠️ DANGER: This will permanently delete ALL ${totalItems} ${itemType}${totalItems === 1 ? '' : 's'} and cannot be undone. Are you absolutely sure?`
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center mb-4">
          <ExclamationTriangleIcon className="w-8 h-8 text-red-500 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">
            {type === 'stop-all' ? `Stop All ${itemType}` : `Delete All ${itemType}`}
          </h3>
        </div>
        <p className="text-sm text-gray-700 mb-6">{message}</p>
        <div className="flex space-x-3">
          <button
            onClick={handleConfirm}
            disabled={isStopAllLoading || isDeleteAllLoading}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              type === 'delete-all' 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'bg-orange-600 text-white hover:bg-orange-700'
            }`}
          >
            {(type === 'stop-all' && isStopAllLoading) || (type === 'delete-all' && isDeleteAllLoading) ? 
              (type === 'stop-all' ? 'Stopping...' : 'Deleting...') : 
              (type === 'stop-all' ? 'Stop All' : 'Delete All')
            }
          </button>
          <button
            onClick={clearAlert}
            disabled={isStopAllLoading || isDeleteAllLoading}
            className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className="bg-yellow-50 border-b border-yellow-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600" />
              <div>
                <h3 className="text-sm font-medium text-yellow-800">{title}</h3>
                <p className="text-xs text-yellow-700">{description}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={showStopAllAlert}
                disabled={isStopAllLoading || isDeleteAllLoading || runningItems === 0}
                className="bg-orange-600 text-white px-3 py-2 rounded-lg hover:bg-orange-700 transition-all flex items-center space-x-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Stop all running ${itemType}`}
              >
                <StopIcon className="w-4 h-4" />
                <span>Stop All ({runningItems})</span>
              </button>
              
              <button
                onClick={showDeleteAllAlert}
                disabled={isStopAllLoading || isDeleteAllLoading || totalItems === 0}
                className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition-all flex items-center space-x-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Delete all ${itemType} (DANGEROUS)`}
              >
                <TrashIcon className="w-4 h-4" />
                <span>Delete All ({totalItems})</span>
              </button>
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
