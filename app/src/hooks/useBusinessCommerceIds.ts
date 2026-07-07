import { useQuery } from '@tanstack/react-query'

import { isConfiguredValue } from '@/lib/analytics/commerce-ids'
import { appFetch, AuthSessionExpiredError } from '@/lib/gasket-config'

interface CommerceBinding {
  storeId: string | null
}

interface CommerceBindingResponse {
  configured: boolean
  binding: CommerceBinding | null
}

export async function fetchCommerceStoreId(appId: string): Promise<string | null> {
  const response = await appFetch(`/api/apps/${appId}/commerce/binding`, {}, { handle401: true })

  if (!response.ok) {
    if (response.status === 401) {
      throw new AuthSessionExpiredError()
    }
    const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } | string; message?: string }
    throw new Error(
      (typeof errorData.error === 'object' ? errorData.error?.message : errorData.error)
      || errorData.message
      || `Failed to fetch commerce binding: ${response.status} ${response.statusText}`.trim(),
    )
  }

  const data = await response.json() as CommerceBindingResponse
  const storeId = data.binding?.storeId
  return isConfiguredValue(storeId ?? undefined) ? storeId : null
}

export function useCommerceStoreId(appId: string | null | undefined) {
  return useQuery({
    queryKey: ['commerce-store-id', appId],
    queryFn: () => fetchCommerceStoreId(appId!),
    enabled: !!appId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
