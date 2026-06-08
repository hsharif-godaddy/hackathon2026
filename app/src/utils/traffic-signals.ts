/**
 * Normalizes pathway session id from the cookie value after one cookie-layer decode
 * (`request.cookies.get('pathway')?.value`).
 */
export function trafficPathwaySessionId(pathwayDecodedValue: string | undefined | null): string | undefined {
  const t = pathwayDecodedValue?.trim()
  if (!t || t.length === 0) {
    return undefined
  }
  return t
}

function sanitizeEntryPointValue(value: string): string | undefined {
  const sanitized = value.trim().slice(0, 64).replace(/[^a-zA-Z0-9._/\-]/g, '_')
  return sanitized || undefined
}

function isGodaddyHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'godaddy.com' || host.endsWith('.godaddy.com')
}

function entryPointFromParentUrl(locationUrl: string): string | undefined {
  try {
    const url = new URL(locationUrl.trim())
    if (!isGodaddyHost(url.hostname)) {
      return undefined
    }
    const path = url.pathname.split('/').filter(Boolean).join('/')
    return path || 'FOS'
  } catch {
    return undefined
  }
}

function normalizeEntryPointCandidate(candidate: string): string | undefined {
  const trimmed = candidate.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const fromUrl = entryPointFromParentUrl(trimmed)
    return fromUrl ? sanitizeEntryPointValue(fromUrl) : undefined
  }
  return sanitizeEntryPointValue(trimmed)
}

// Resolves entry point from ?location (parent URL), ?itc, ?site_location (in that order); sanitizes and falls back when all are empty.
export function resolveEntryPoint(
  candidates: (string | null | undefined)[],
  fallback: string
): string {
  for (const candidate of candidates) {
    if (!candidate) continue
    const sanitized = normalizeEntryPointCandidate(candidate)
    if (sanitized) return sanitized
  }
  return fallback
}

// Reads entry point from sessionStorage with job→app fallback; returns undefined when not set.
export function readEntryPointFromSession(appId: string): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const stored = sessionStorage.getItem(`entry-point-${appId}`)
  if (stored != null) return stored
  const jobId = sessionStorage.getItem(`initial-job-id-${appId}`)
  if (jobId) {
    const fromJob = sessionStorage.getItem(`entry-point-${jobId}`)
    if (fromJob != null) return fromJob
  }
  return undefined
}

type UploadedFileLike = { isUiKit?: boolean; isZip?: boolean } | null | undefined

// Resolves creation_source for a site creation event (ui_kit_import > code_import > design_file > logo_design > business_plan > example_selected > free_text).
export function resolveCreationSource(
  uploadedFile: UploadedFileLike,
  templateId: string | null | undefined,
  submitSource: 'text' | 'example',
): string {
  if (uploadedFile?.isUiKit) return 'ui_kit_import'
  if (uploadedFile?.isZip) return 'code_import'
  if (uploadedFile) return 'design_file'
  if (templateId === 'logo-designer') return 'logo_design'
  if (templateId === 'business-plan') return 'business_plan'
  if (submitSource === 'example') return 'example_selected'
  return 'free_text'
}

// Reads creation_source stored during the create flow; returns undefined when not set.
export function readCreationSourceFromSession(appId: string): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const stored = sessionStorage.getItem(`creation-source-${appId}`)
  if (stored != null) return stored
  const jobId = sessionStorage.getItem(`initial-job-id-${appId}`)
  if (jobId) {
    const fromJob = sessionStorage.getItem(`creation-source-${jobId}`)
    if (fromJob != null) return fromJob
  }
  return undefined
}

// Reads intent_category stored during the create flow; returns undefined when not present.
export function readIntentCategoryFromSession(appId: string): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined
  const stored = sessionStorage.getItem(`intent-category-${appId}`)
  if (stored != null) return stored
  const jobId = sessionStorage.getItem(`initial-job-id-${appId}`)
  if (jobId) {
    const fromJob = sessionStorage.getItem(`intent-category-${jobId}`)
    if (fromJob != null) return fromJob
  }
  return undefined
}
