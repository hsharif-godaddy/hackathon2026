import type { QueryClient, QueryKey } from '@tanstack/react-query'

interface WaitForUpdateOptions {
  maxAttempts?: number
  intervalMs?: number
}

export function invalidatePlanQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['subscriptions'] })
  queryClient.invalidateQueries({ queryKey: ['active-subscription'] })
  queryClient.invalidateQueries({ queryKey: ['paywall-feature-flags'] })
  queryClient.invalidateQueries({ queryKey: ['credit-grants'] })
}

export async function waitForQueryUpdate<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  hasChanged: (data: T | undefined) => boolean,
  options: WaitForUpdateOptions = {}
): Promise<boolean> {
  const { maxAttempts = 30, intervalMs = 1000 } = options

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await queryClient.refetchQueries({ queryKey })

    if (hasChanged(queryClient.getQueryData<T>(queryKey))) {
      return true
    }

    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
  }

  return false
}
