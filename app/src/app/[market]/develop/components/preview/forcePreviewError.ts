import { isLocalDev } from '@/utils/is-local-dev'

export type ForcedPreviewError = 'server' | 'iframe'

export function getForcedPreviewError(
  searchParams: Pick<URLSearchParams, 'get'> | null,
): ForcedPreviewError | null {
  if (!isLocalDev()) return null

  const fromRouter = searchParams?.get('forcePreviewError')
  const fromWindow =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('forcePreviewError')
      : null
  const value = fromRouter ?? fromWindow

  if (value === 'server' || value === 'iframe') return value

  return null
}
