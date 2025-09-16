// Pricing per 1000 tokens (in USD)
const PRICING = {
  input: 0.003,        // Regular input tokens
  output: 0.015,       // Output tokens  
  cacheWrite: 0.00375, // Cache write tokens
  cacheRead: 0.0003    // Cache read tokens
} as const

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
}

export interface CostBreakdown {
  regularInputTokens: number
  cachedInputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  regularInputCost: number
  cachedInputCost: number
  outputCost: number
  cacheWriteCost: number
  totalCost: number
}

export function calculateCost(usage: TokenUsage): CostBreakdown {
  const outputTokens = usage.outputTokens || 0
  const totalInputTokens = usage.inputTokens || 0
  const cachedInputTokens = usage.cachedInputTokens || 0
  
  // Calculate different token types
  const regularInputTokens = Math.max(0, totalInputTokens - cachedInputTokens)
  const cacheWriteTokens = 0 // This would need to be provided separately if available
  
  // Calculate costs (divide by 1000 since pricing is per 1000 tokens)
  const regularInputCost = (regularInputTokens / 1000) * PRICING.input
  const cachedInputCost = (cachedInputTokens / 1000) * PRICING.cacheRead
  const outputCost = (outputTokens / 1000) * PRICING.output
  const cacheWriteCost = (cacheWriteTokens / 1000) * PRICING.cacheWrite
  
  const totalCost = regularInputCost + cachedInputCost + outputCost + cacheWriteCost
  
  return {
    regularInputTokens,
    cachedInputTokens,
    outputTokens,
    cacheWriteTokens,
    regularInputCost,
    cachedInputCost,
    outputCost,
    cacheWriteCost,
    totalCost
  }
}

export function formatCost(cost: number): string {
  if (cost < 0.001) {
    return '<$0.001'
  }
  return `$${cost.toFixed(4)}`
}

export function formatTime(timestamp: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - timestamp.getTime()
  
  if (diffMs < 60000) { // Less than 1 minute
    const seconds = Math.floor(diffMs / 1000)
    return `${seconds}s ago`
  } else if (diffMs < 3600000) { // Less than 1 hour
    const minutes = Math.floor(diffMs / 60000)
    return `${minutes}m ago`
  } else if (diffMs < 86400000) { // Less than 1 day
    const hours = Math.floor(diffMs / 3600000)
    return `${hours}h ago`
  } else {
    return timestamp.toLocaleDateString() + ' ' + timestamp.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  }
}
