/**
 * Default English copy for business analytics UI keys (dev fallback until published in @airo-app-builder/aab).
 */
export const BUSINESS_ANALYTICS_DEFAULT_MESSAGES: Record<string, string> = {
  builder_analytics_business_analytics: 'Business Analytics',
  builder_analytics_business_sales_overview: 'Sales Overview',
  builder_analytics_business_total_revenue: 'Total Revenue',
  builder_analytics_business_daily_revenue: 'Daily Revenue',
  builder_analytics_business_no_orders: 'No orders in this period.',
  builder_analytics_business_order_count: 'Order Count',
}

export function defaultMessageForBusinessAnalyticsKey(key: string): string | undefined {
  return BUSINESS_ANALYTICS_DEFAULT_MESSAGES[key]
}
