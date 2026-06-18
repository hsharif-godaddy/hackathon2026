export const ADSENSE_MANIFEST_FILENAME = 'airo-adsense.json'
export const ADSENSE_AUTHORING_CONFIG_PATH = '.airo/adsense.json'
export const ADSENSE_RUNTIME_MANIFEST_PATH = `dist/${ADSENSE_MANIFEST_FILENAME}`
export const ADSENSE_TEXT_MAX_BYTES = 100 * 1024
export const ADSENSE_PUBLISHER_ID_PATTERN = /^ca-pub-\d{16}$/

export interface AdSenseTextFileSettings {
  enabled: boolean
  content: string
}

export interface AdSenseSettings {
  enabled: boolean
  publisherId: string | null
  scriptSnippet: string
  adsTxt: AdSenseTextFileSettings
  appAdsTxt: AdSenseTextFileSettings
  updatedAt: string | null
}

export interface AdSenseSettingsInput {
  enabled: boolean
  scriptSnippet?: string
  adsTxt?: Partial<AdSenseTextFileSettings>
  appAdsTxt?: Partial<AdSenseTextFileSettings>
}

export interface AdSenseSettingsWrite {
  enabled: boolean
  publisherId: string | null
  scriptSnippet: string
  adsTxt: AdSenseTextFileSettings
  appAdsTxt: AdSenseTextFileSettings
}

export interface AdSensePublishManifest {
  version: 1
  enabled: boolean
  publisherId: string | null
  scriptSnippet: string
  adsTxt: AdSenseTextFileSettings
  appAdsTxt: AdSenseTextFileSettings
}

export type AdSenseFieldName = 'enabled' | 'scriptSnippet' | 'adsTxt' | 'appAdsTxt'
export type AdSenseValidationErrors = Partial<Record<AdSenseFieldName, string>>

export type AdSenseParseResult =
  | { ok: true; publisherId: string }
  | { ok: false; error: string }

export type AdSenseNormalizeResult =
  | { ok: true; value: AdSenseSettingsWrite }
  | { ok: false; errors: AdSenseValidationErrors }
