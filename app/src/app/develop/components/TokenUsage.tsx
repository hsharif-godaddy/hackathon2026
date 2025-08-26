'use client'

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import {
  ChartBarIcon,
  CurrencyDollarIcon,
  ClockIcon,
  CpuChipIcon,
  ChevronDownIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'

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
  className?: string
  enabled?: boolean // Control visibility via SHOW_USAGE_COST env variable
}

export interface TokenUsageRef {
  refreshUsage: () => void
}

const TokenUsage = forwardRef<TokenUsageRef, TokenUsageProps>(
  ({ appId, className = '', enabled = false }, ref) => {
    const [usage, setUsage] = useState<TokenUsageInfo | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isExpanded, setIsExpanded] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const fetchUsage = async () => {
      try {
        setIsLoading(true)
        const response = await fetch(`http://localhost:4000/apps/${appId}/usage`)
        if (!response.ok) {
          throw new Error('Failed to fetch usage data')
        }
        const data = await response.json()
        setUsage(data.usage)
      } catch (error) {
        console.error('Error fetching token usage:', error)
        setError(error instanceof Error ? error.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    // Expose refresh function via ref
    useImperativeHandle(ref, () => ({
      refreshUsage: fetchUsage
    }), [appId])

    useEffect(() => {
      if (appId && enabled) {
        fetchUsage()
      }
    }, [appId, enabled])

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
      <div className={`flex items-center space-x-2 text-gray-500 ${className}`}>
        <CpuChipIcon className="w-4 h-4 animate-pulse" />
        <span className="text-sm">Loading usage...</span>
      </div>
    )
  }

  if (error || !usage) {
    return (
      <div className={`flex items-center space-x-2 text-gray-400 ${className}`}>
        <CpuChipIcon className="w-4 h-4" />
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
        className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 transition-colors group"
      >
        <CpuChipIcon className="w-4 h-4" />
        <span className="text-sm font-medium">
          {formatNumber(usage.totalTokens)}
        </span>
        {usage.totalCost > 0 && (
          <span className="text-xs text-gray-500">
            ({formatCost(usage.totalCost)})
          </span>
        )}
        <ChevronDownIcon 
          className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''} group-hover:text-gray-700`} 
        />
      </button>

      {/* Expanded View */}
      {isExpanded && (
        <div className="absolute top-full right-0 mt-2 p-4 bg-white rounded-lg border shadow-lg z-50 min-w-80">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-gray-900">Token Usage Breakdown</h4>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
          
          {/* Usage Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-gray-50 p-3 rounded border">
              <div className="flex items-center space-x-2 mb-2">
                <ChartBarIcon className="w-4 h-4 text-blue-500" />
                <span className="text-xs font-medium text-gray-700">Total Tokens</span>
              </div>
              <div className="text-xl font-bold text-gray-900 mb-1">
                {formatNumber(usage.totalTokens)}
              </div>
              <div className="text-xs text-gray-600">
                {formatNumber(usage.promptTokens)} in + {formatNumber(usage.completionTokens)} out
              </div>
            </div>

            <div className="bg-gray-50 p-3 rounded border">
              <div className="flex items-center space-x-2 mb-2">
                <CurrencyDollarIcon className="w-4 h-4 text-green-500" />
                <span className="text-xs font-medium text-gray-700">Estimated Cost</span>
              </div>
              <div className="text-xl font-bold text-gray-900 mb-1">
                {formatCost(usage.totalCost)}
              </div>
              <div className="text-xs text-gray-600">
                Based on model pricing
              </div>
            </div>
          </div>

          {/* Operation Breakdown */}
          <div className="space-y-3">
            <h5 className="text-xs font-semibold text-gray-800 uppercase tracking-wide">Operations</h5>
            
            <div className="space-y-2">
              <div className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-2">🤖</span>
                  AI Requests
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.llm_request}</span>
              </div>
              
              <div className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-2">📝</span>
                  File Edits
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.file_edit}</span>
              </div>
              
              <div className="flex justify-between items-center py-2 px-3 bg-gray-50 rounded">
                <span className="text-sm text-gray-700 flex items-center">
                  <span className="mr-2">🔧</span>
                  Tool Executions
                </span>
                <span className="font-semibold text-gray-900">{usage.operationCounts.tool_execution}</span>
              </div>
            </div>
          </div>

          {/* Last Used */}
          {usage.lastUsed && (
            <div className="mt-4 pt-3 border-t border-gray-200">
              <div className="flex items-center space-x-2 text-xs text-gray-500">
                <ClockIcon className="w-4 h-4" />
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
