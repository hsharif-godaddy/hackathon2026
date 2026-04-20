export interface SpendDay {
    date: string;
    spend: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    requests: number;
}

export interface GrantBreakdown {
    grantUserId: string;
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    dailySpend: SpendDay[];
}

export interface LlmSpendData {
    subscriptionId?: string;
    grantUserIds: string[];
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    grantBreakdowns: GrantBreakdown[];
    docCount: number;
    truncated?: boolean;
}
