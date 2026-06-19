import { SiteInfo } from '@/lib/control-plane/types'

export type ProjectType = 'website' | 'logo'

/**
 * Derive a project type for the All Projects / Website-Apps / Logo tabs.
 *
 * NOTE: the control-plane `SiteInfo` model does not yet expose a first-class
 * project-type taxonomy. Until it does, we infer "logo" from the prompt/name.
 * Everything else is treated as a website/app. This is intentionally
 * conservative so the redesign can ship behind the existing data shape; swap
 * this for a real field once the API provides one.
 */
export function getProjectType(site: SiteInfo): ProjectType {
  const haystack = `${site.name ?? ''} ${site.initial_prompt ?? ''}`.toLowerCase()
  if (/\blogos?\b/.test(haystack) && !/\bno\s+logos?\b/.test(haystack)) {
    return 'logo'
  }
  return 'website'
}
