import { appFetch, type AppFetchOptions } from '@/lib/gasket-config'
import { getItcOverride } from '@/lib/itc'

export interface QuickCreateResponse {
  id: string
  name?: string
  status: string
  account_id: string
  created_at?: string
  updated_at?: string
  type: 'job' | 'site'
}

interface FetchQuickCreateOptions {
  productId?: string
}

export async function fetchQuickCreate(prompt: string, fetchOptions?: AppFetchOptions, options?: FetchQuickCreateOptions) {
  return appFetch('/api/sites/quick-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initialPrompt: prompt,
      itc: getItcOverride() ?? undefined,
      ...(options?.productId && { productId: options.productId }),
    }),
  }, fetchOptions)
}

interface ApiErrorData {
  message?: string
  error?: string
  details?: string
}

export function extractApiError(errorData: ApiErrorData): Error {
  const error = new Error(errorData.message || errorData.error || 'Failed to create site')
  if (errorData.details) {
    Object.assign(error, { details: errorData.details })
  }
  return error
}

export function setQuickCreateSessionFlags(siteId: string, prompt: string, templateId?: string) {
  sessionStorage.setItem(`name-registration-pending-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-pending-${siteId}`, 'true')
  sessionStorage.setItem(`in-creation-flow-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-text-${siteId}`, prompt)
  if (templateId && templateId !== 'default') {
    sessionStorage.setItem(`initial-template-${siteId}`, templateId)
  }
}

export function buildDevelopUrl(siteId: string, siteType: string): string {
  return siteType === 'job' ? `/develop/${siteId}?type=job` : `/develop/${siteId}`
}
