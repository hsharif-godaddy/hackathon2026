import {
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_TEXT_MAX_BYTES,
  type AdSenseNormalizeResult,
  type AdSenseParseResult,
  type AdSenseTextFileSettings,
  type AdSenseValidationErrors,
} from './types.js'

const ADSENSE_SCRIPT_HOST = 'pagead2.googlesyndication.com'
const ADSENSE_SCRIPT_PATH = '/pagead/js/adsbygoogle.js'

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function buildCanonicalAdSenseScript(publisherId: string): string {
  if (!ADSENSE_PUBLISHER_ID_PATTERN.test(publisherId)) {
    throw new Error('Invalid AdSense publisher ID.')
  }

  return `<script async src="https://${ADSENSE_SCRIPT_HOST}${ADSENSE_SCRIPT_PATH}?client=${publisherId}" crossorigin="anonymous"></script>`
}

export function parseAdSensePublisherIdFromSnippet(snippet: string): AdSenseParseResult {
  const trimmed = snippet.trim()
  if (!trimmed) {
    return { ok: false, error: 'AdSense script snippet is empty.' }
  }

  if (!/^<script\b[\s\S]*>\s*<\/script>$/i.test(trimmed)) {
    return { ok: false, error: 'Paste the full AdSense script tag from Google.' }
  }

  const srcMatch = trimmed.match(/\bsrc\s*=\s*["']([^"']+)["']/i)
  if (!srcMatch?.[1]) {
    return { ok: false, error: 'Paste the full AdSense script tag from Google.' }
  }

  let scriptUrl: URL
  try {
    scriptUrl = new URL(srcMatch[1])
  } catch {
    return { ok: false, error: 'AdSense script source is not a valid URL.' }
  }

  if (scriptUrl.hostname !== ADSENSE_SCRIPT_HOST || scriptUrl.pathname !== ADSENSE_SCRIPT_PATH) {
    return { ok: false, error: 'AdSense script must load from pagead2.googlesyndication.com.' }
  }

  const publisherId = scriptUrl.searchParams.get('client') ?? ''
  if (!ADSENSE_PUBLISHER_ID_PATTERN.test(publisherId)) {
    return { ok: false, error: 'AdSense publisher ID must look like ca-pub-1234567890123456.' }
  }

  return { ok: true, publisherId }
}

function normalizeTextFile(
  label: 'ads.txt' | 'app-ads.txt',
  input: unknown,
  options: { requireContent: boolean }
): { value: AdSenseTextFileSettings; error?: string } {
  if (input === undefined) {
    return { value: { enabled: false, content: '' } }
  }

  if (!isRecord(input)) {
    return { value: { enabled: false, content: '' }, error: `${label} settings must be an object.` }
  }

  const { enabled: rawEnabled, content: rawContent } = input
  if (rawEnabled !== undefined && typeof rawEnabled !== 'boolean') {
    return { value: { enabled: false, content: '' }, error: `${label} enabled must be a boolean.` }
  }

  const enabled = rawEnabled === true
  if (rawContent !== undefined && typeof rawContent !== 'string') {
    return { value: { enabled, content: '' }, error: `${label} content must be a string.` }
  }

  const content = rawContent ?? ''

  if (content.includes('\0')) {
    return { value: { enabled, content }, error: `${label} content cannot contain null bytes.` }
  }

  if (options.requireContent && enabled && content.trim().length === 0) {
    return { value: { enabled, content }, error: `${label} content is required when enabled.` }
  }

  if (byteLength(content) > ADSENSE_TEXT_MAX_BYTES) {
    return { value: { enabled, content }, error: `${label} content must be 100KB or smaller.` }
  }

  return { value: { enabled, content } }
}

export function normalizeAdSenseSettingsInput(input: unknown): AdSenseNormalizeResult {
  const errors: AdSenseValidationErrors = {}
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: {
        scriptSnippet: 'AdSense settings input must be an object.',
      },
    }
  }

  const rawEnabled = input.enabled
  if (typeof rawEnabled !== 'boolean') {
    errors.enabled = 'Display Ads enabled must be a boolean.'
  }

  const rawSnippet = input.scriptSnippet
  if (rawSnippet !== undefined && typeof rawSnippet !== 'string') {
    errors.scriptSnippet = 'AdSense script snippet must be a string.'
  }

  const trimmedSnippet = typeof rawSnippet === 'string' ? rawSnippet.trim() : ''
  let publisherId: string | null = null
  let scriptSnippet = ''

  if (!errors.scriptSnippet && trimmedSnippet) {
    const parsed = parseAdSensePublisherIdFromSnippet(trimmedSnippet)
    if (parsed.ok) {
      publisherId = parsed.publisherId
      scriptSnippet = buildCanonicalAdSenseScript(parsed.publisherId)
    } else {
      errors.scriptSnippet = parsed.error
    }
  }

  const requireTextFileContent = rawEnabled === true
  const adsTxt = normalizeTextFile('ads.txt', input.adsTxt, { requireContent: requireTextFileContent })
  if (adsTxt.error) {
    errors.adsTxt = adsTxt.error
  }

  const appAdsTxt = normalizeTextFile('app-ads.txt', input.appAdsTxt, { requireContent: requireTextFileContent })
  if (appAdsTxt.error) {
    errors.appAdsTxt = appAdsTxt.error
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  const enabled = rawEnabled === true

  return {
    ok: true,
    value: {
      enabled,
      publisherId,
      scriptSnippet,
      adsTxt: adsTxt.value,
      appAdsTxt: appAdsTxt.value,
    },
  }
}
