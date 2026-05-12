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

  return (
    <div className="inline-flex items-center space-x-1 px-1.5 py-1 rounded-lg border">
      {getStatusIcon()}
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}
