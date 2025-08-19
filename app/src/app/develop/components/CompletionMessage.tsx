'use client'

import { CheckCircleIcon, ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/24/outline'

interface CompletionMessageProps {
  duration: number
  threadId?: string
  error?: string
}

export default function CompletionMessage({ duration, threadId, error }: CompletionMessageProps) {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(1)
    return `${minutes}m ${seconds}s`
  }

  const isError = Boolean(error)
  
  return (
    <div className={`inline-flex items-center space-x-2 px-3 py-2 rounded-lg border ${
      isError 
        ? 'border-red-200 bg-red-50' 
        : 'border-green-200 bg-green-50'
    }`}>
      {isError ? (
        <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
      ) : (
        <CheckCircleIcon className="w-4 h-4 text-green-500" />
      )}
      <span className={`text-sm font-medium ${
        isError ? 'text-red-800' : 'text-green-800'
      }`}>
        {isError ? 'Task failed' : 'Task completed'}
      </span>
      <div className={`flex items-center space-x-1 text-xs ${
        isError ? 'text-red-600' : 'text-green-600'
      }`}>
        <ClockIcon className="w-3 h-3" />
        <span>
          {formatDuration(duration)}
        </span>
      </div>
      {threadId && (
        <span className={`text-xs font-mono ${
          isError ? 'text-red-500' : 'text-green-500'
        }`}>
          {threadId.slice(0, 8)}
        </span>
      )}
    </div>
  )
}
