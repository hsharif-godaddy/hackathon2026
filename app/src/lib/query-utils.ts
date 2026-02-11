import type { QueryClient, QueryKey } from '@tanstack/react-query'

interface WaitForUpdateOptions {
  maxAttempts?: number
  intervalMs?: number
}

/**
 * Polls a query until a condition is met or timeout is reached.
 * Useful for waiting on external services to reflect changes (e.g., after purchase).
 *
 * @param queryClient - React Query client
 * @param queryKey - Query key to refetch
 * @param hasChanged - Predicate that returns true when the expected change is detected
 * @param options - Polling options (maxAttempts defaults to 30, intervalMs defaults to 1000)
 * @returns true if condition was met, false if timed out
 */
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
