import React from 'react'
import { Badge } from '@/components/ui/badge'
import { calculateCost, formatCost, formatTime, type TokenUsage } from '../utils/cost-calculator'

interface MessageMetadataProps {
  timestamp: Date
  usage?: TokenUsage
  className?: string
}

export function MessageMetadata({ timestamp, usage, className = '' }: MessageMetadataProps) {
  if (!usage) {
    return (
      <div className={`flex flex-wrap gap-2 mt-3 pt-3 border-t border-border ${className}`}>
        <Badge variant="outline" className="text-xs">
          📅 {formatTime(timestamp)}
        </Badge>
      </div>
    )
  }

  const cost = calculateCost(usage)

  return (
    <div className={`flex flex-wrap gap-2 mt-3 pt-3 border-t border-border ${className}`}>
      <Badge variant="outline" className="text-xs">
        📅 {formatTime(timestamp)}
      </Badge>
      
      {cost.cacheWriteTokens > 0 && (
        <Badge variant="outline" className="text-xs">
          📝 Cache Write: {cost.cacheWriteTokens.toLocaleString()}
        </Badge>
      )}
      
      {cost.cachedInputTokens > 0 && (
        <Badge variant="outline" className="text-xs">
          💾 Cached Input: {cost.cachedInputTokens.toLocaleString()}
        </Badge>
      )}
      
      {cost.regularInputTokens > 0 && (
        <Badge variant="outline" className="text-xs">
          📥 Input: {cost.regularInputTokens.toLocaleString()}
        </Badge>
      )}
      
      {cost.outputTokens > 0 && (
        <Badge variant="outline" className="text-xs">
          📤 Output: {cost.outputTokens.toLocaleString()}
        </Badge>
      )}
      
      <Badge variant="default" className="text-xs bg-green-100 text-green-800 border-green-300">
        💰 {formatCost(cost.totalCost)}
      </Badge>
    </div>
  )
}

export default MessageMetadata
