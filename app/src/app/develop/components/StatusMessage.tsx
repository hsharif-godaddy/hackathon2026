'use client'

import { ClockIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface StatusMessageProps {
  status: string
  message: string
}

export default function StatusMessage({ status, message }: StatusMessageProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'executing_tools':
        return <ClockIcon className="w-4 h-4 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />
      case 'error':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
      default:
        return <ClockIcon className="w-4 h-4 text-blue-500" />
    }
  }

  const getStatusColor = () => {
    switch (status) {
      case 'executing_tools':
        return 'bg-blue-50 border-blue-200 text-blue-800'
      case 'completed':
        return 'bg-green-50 border-green-200 text-green-800'
      case 'error':
        return 'bg-red-50 border-red-200 text-red-800'
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800'
    }
  }

  return (
    <div className={`inline-flex items-center space-x-2 px-3 py-2 rounded-lg border ${getStatusColor()}`}>
      {getStatusIcon()}
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}
