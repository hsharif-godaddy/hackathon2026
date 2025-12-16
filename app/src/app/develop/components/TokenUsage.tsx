'use client'

import { forwardRef, useCallback,useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  ChartBarIcon,
  ChevronDownIcon,
  ClockIcon,
  CpuChipIcon,
  CurrencyDollarIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

import { logger } from '@/lib/request-context'
import { appService } from '@/services/AppService'

interface TokenUsageInfo {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  totalCost: number
  operationCounts: {
    llm_request: number
    file_edit: number
    tool_execution: number
  }
  lastUsed: string | null
}

interface TokenUsageProps {
  appId: string
  siteId?: string
  className?: string
  enabled?: boolean // Control visibility via SHOW_USAGE_COST env variable
}

export interface TokenUsageRef {
  refreshUsage: () => void
}

const TokenUsage = forwardRef<TokenUsageRef, TokenUsageProps>(
  ({ appId, siteId, className = '', enabled = false }, ref) => {
    const [usage, setUsage] = useState<TokenUsageInfo | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isExpanded, setIsExpanded] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const fetchUsage = useCallback(async () => {
      try {
        setIsLoading(true)
        const data = await appService.getTokenUsage(siteId || appId)
        setUsage(data.usage)
      } catch (error) {
        logger.error('token_usage.fetch.failed', {
          siteId: siteId || appId,
          error: error instanceof Error ? error.message : String(error)
        })
        setError(error instanceof Error ? error.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }, [siteId, appId])

    // Expose refresh function via ref
    useImperativeHandle(ref, () => ({
      refreshUsage: fetchUsage
    }), [fetchUsage])

    useEffect(() => {
      if (appId && enabled) {
        fetchUsage()
      }
    }, [appId, enabled, fetchUsage])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsExpanded(false)
      }
    }

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExpanded])

  // Don't render if not enabled (default: hidden for privacy)
  if (!enabled) {
    return null
  }

  if (isLoading) {
    return (
      <div className={`flex items-center space-x-1 text-gray-500 ${className}`}>
        <CpuChipIcon className="w-2 h-2 animate-pulse" />
        <span className="text-sm">Loading usage...</span>
      </div>
    )
  }

  if (error || !usage) {
    return (
      <div className={`flex items-center space-x-1 text-gray-400 ${className}`}>
        <CpuChipIcon className="w-2 h-2" />
        <span className="text-sm">Usage unavailable</span>
      </div>
    )
  }

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`
    }
    return num.toString()
  }

  const formatCost = (cost: number): string => {
    if (cost < 0.01) {
      return '<$0.01'
    }
    return `$${cost.toFixed(2)}`
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Compact View */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center space-x-1 text-gray-600 hover:text-gray-800 transition-colors group"
      >
        <CpuChipIcon className="w-2 h-2" />
        <span className="text-sm font-medium">
          {formatNumber(usage.totalTokens)}
        </span>
        {usage.totalCost > 0 && (
          <span className="text-xs text-gray-500">
            ({formatCost(usage.totalCost)})
          </span>
        )}
        <ChevronDownIcon
          className={`w-1.5 h-1.5 transition-transform ${isExpanded ? 'rotate-180' : ''} group-hover:text-gray-700`}
        />
      </button>

      {/* Expanded View */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-1 p-2 bg-white rounded-lg border shadow-lg z-50 min-w-40">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="text-sm font-semibold text-gray-900">Token Usage Breakdown</h4>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="w-2 h-2" />
            </button>
          </div>

          {/* Usage Stats */}
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            <div className="bg-gray-50 p-1.5 rounded border">
              <div className="flex items-center space-x-1 mb-1">
                <ChartBarIcon className="w-2 h-2 text-blue-500" />
                <span className="text-xs font-medium text-gray-700">Total Tokens</span>
              </div>
              <div className="text-xl font-bold text-gray-900 mb-0.5">
                {formatNumber(usage.totalTokens)}
              </div>
              <div className="text-xs text-gray-600">
                {formatNumber(usage.promptTokens)} in + {formatNumber(usage.completionTokens)} out
              </div>
            </div>

            <div className="bg-gray-50 p-1.5 rounded border">
              <div className="flex items-center space-x-1 mb-1">
                <CurrencyDollarIcon className="w-2 h-2 text-green-500" />
                <span className="text-xs font-medium text-gray-700">Estimated Cost</span>
              </div>
              <div className="text-xl font-bold text-gray-900 mb-0.5">
                {formatCost(usage.totalCost)}
              </div>
              <div className="text-xs text-gray-600">
                Based on model pricing
              </div>
            </div>
          </div>

          {/* Operation Breakdown */}
          <div className="space-y-1.5">
            <h5 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Operations</h5>

            <div className="space-y-1">
              <div className="flex justify-between items-center py-1 px-1.5 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-1">🤖</span>
                  AI Requests
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.llm_request}</span>
              </div>

              <div className="flex justify-between items-center py-1 px-1.5 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-1">📝</span>
                  File Edits
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.file_edit}</span>
              </div>

              <div className="flex justify-between items-center py-1 px-1.5 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-1">🔧</span>
                  Tool Executions
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.tool_execution}</span>
              </div>
            </div>
          </div>

          {/* Last Used */}
          {usage.lastUsed && (
            <div className="mt-2 pt-1.5 border-t border-gray-200">
              <div className="flex items-center space-x-1 text-xs text-gray-500">
                <ClockIcon className="w-2 h-2" />
                <span>Last activity: {new Date(usage.lastUsed).toLocaleDateString()} at {new Date(usage.lastUsed).toLocaleTimeString()}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

TokenUsage.displayName = 'TokenUsage'

export default TokenUsage
