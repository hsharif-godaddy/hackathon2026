'use client'

import { CheckCircleIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface StatusMessageProps {
  status: string
  message: string
}

export default function StatusMessage({ status, message }: StatusMessageProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'executing_tools':
        return <ClockIcon className="w-2 h-2 text-blue-500 animate-spin" />
      case 'completed':
        return <CheckCircleIcon className="w-2 h-2 text-green-500" />
      case 'error':
        return <ExclamationTriangleIcon className="w-2 h-2 text-red-500" />
      default:
        return <ClockIcon className="w-2 h-2 text-blue-500" />
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
    <div className={`inline-flex items-center space-x-1 px-1.5 py-1 rounded-lg border ${getStatusColor()}`}>
      {getStatusIcon()}
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}
