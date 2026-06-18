import { describe, expect, it } from 'vitest'

import { APP_CONFIG_FILES, APP_DIRECTORIES } from '../../app-structure/index.js'
import {
  ADSENSE_AUTHORING_CONFIG_PATH,
  ADSENSE_TEXT_MAX_BYTES,
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  parseAdSensePublisherIdFromSnippet,
} from '../index.js'

const publisherId = 'ca-pub-1234567890123456'
const canonicalScript = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>'

describe('adsense validation', () => {
  it('extracts the publisher id from a Google AdSense script tag', () => {
    expect(parseAdSensePublisherIdFromSnippet(canonicalScript)).toEqual({
      ok: true,
      publisherId,
    })
  })

  it('rejects non-script markup even when it contains a src attribute', () => {
    expect(
      parseAdSensePublisherIdFromSnippet(
        '<img src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456">'
      )
    ).toEqual({
      ok: false,
      error: 'Paste the full AdSense script tag from Google.',
    })
  })

  it('rejects scripts that do not load from the expected Google domain', () => {
    expect(
      parseAdSensePublisherIdFromSnippet(
        '<script src="https://example.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"></script>'
      )
    ).toEqual({
      ok: false,
      error: 'AdSense script must load from pagead2.googlesyndication.com.',
    })
  })

  it('rejects scripts that do not load from the expected Google path', () => {
    expect(
      parseAdSensePublisherIdFromSnippet(
        '<script src="https://pagead2.googlesyndication.com/pagead/js/other.js?client=ca-pub-1234567890123456"></script>'
      )
    ).toEqual({
      ok: false,
      error: 'AdSense script must load from pagead2.googlesyndication.com.',
    })
  })

  it('rejects malformed publisher ids', () => {
    expect(
      parseAdSensePublisherIdFromSnippet(
        '<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123"></script>'
      )
    ).toEqual({
      ok: false,
      error: 'AdSense publisher ID must look like ca-pub-1234567890123456.',
    })
  })

  it('builds the canonical script from a safe publisher id', () => {
    expect(buildCanonicalAdSenseScript(publisherId)).toBe(canonicalScript)
  })

  it('normalizes blank script input to disabled settings', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: false,
        scriptSnippet: '   ',
        adsTxt: { enabled: false, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: '' },
      })
    ).toEqual({
      ok: true,
      value: {
        enabled: false,
        publisherId: null,
        scriptSnippet: '',
        adsTxt: { enabled: false, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: '' },
      },
    })
  })

  it('normalizes a valid script to the canonical script', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: `<script crossorigin="anonymous" src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisherId}" async></script>`,
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
      })
    ).toEqual({
      ok: true,
      value: {
        enabled: true,
        publisherId,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
      },
    })
  })

  it('preserves configured values when Display Ads are explicitly disabled', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: false,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      })
    ).toEqual({
      ok: true,
      value: {
        enabled: false,
        publisherId,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: true, content: 'app.example.com, pub-123, DIRECT' },
      },
    })
  })

  it('returns a validation error when Display Ads enabled is missing', () => {
    expect(
      normalizeAdSenseSettingsInput({
        scriptSnippet: '',
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: '' },
      })
    ).toEqual({
      ok: false,
      errors: {
        enabled: 'Display Ads enabled must be a boolean.',
      },
    })
  })

  it('returns a validation error for non-object settings input', () => {
    expect(normalizeAdSenseSettingsInput(null as never)).toEqual({
      ok: false,
      errors: {
        scriptSnippet: 'AdSense settings input must be an object.',
      },
    })
  })

  it('returns a validation error for non-string script snippets', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: 123,
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
      } as never)
    ).toEqual({
      ok: false,
      errors: {
        scriptSnippet: 'AdSense script snippet must be a string.',
      },
    })
  })

  it('returns validation errors for malformed text file settings', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: canonicalScript,
        adsTxt: 'enabled',
        appAdsTxt: { enabled: 'true', content: 123 },
      } as never)
    ).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt settings must be an object.',
        appAdsTxt: 'app-ads.txt enabled must be a boolean.',
      },
    })
  })

  it('returns a validation error for non-boolean Display Ads enabled input', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: 'yes',
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
      } as never)
    ).toEqual({
      ok: false,
      errors: {
        enabled: 'Display Ads enabled must be a boolean.',
      },
    })
  })

  it('returns validation errors for non-string text file content', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: 123 },
        appAdsTxt: { enabled: true, content: 456 },
      } as never)
    ).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content must be a string.',
        appAdsTxt: 'app-ads.txt content must be a string.',
      },
    })
  })

  it('requires enabled text files to have content', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: ' ' },
        appAdsTxt: { enabled: false, content: '' },
      })
    ).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content is required when enabled.',
      },
    })
  })

  it('limits each text file to 100KB by byte length', () => {
    const tooLarge = 'é'.repeat(Math.floor(ADSENSE_TEXT_MAX_BYTES / 2) + 1)
    expect(tooLarge.length).toBeLessThanOrEqual(ADSENSE_TEXT_MAX_BYTES)

    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: tooLarge },
        appAdsTxt: { enabled: true, content: tooLarge },
      })
    ).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content must be 100KB or smaller.',
        appAdsTxt: 'app-ads.txt content must be 100KB or smaller.',
      },
    })
  })

  it('rejects null bytes in text files', () => {
    expect(
      normalizeAdSenseSettingsInput({
        enabled: true,
        scriptSnippet: canonicalScript,
        adsTxt: { enabled: true, content: 'google.com\0, pub-123, DIRECT' },
        appAdsTxt: { enabled: true, content: 'google.com\0, pub-123, DIRECT' },
      })
    ).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content cannot contain null bytes.',
        appAdsTxt: 'app-ads.txt content cannot contain null bytes.',
      },
    })
  })
})

describe('adsense app structure allowlist', () => {
  it('allowlists only the AdSense authoring config file and not the .airo directory', () => {
    expect(APP_CONFIG_FILES).toContain(ADSENSE_AUTHORING_CONFIG_PATH)
    expect(APP_DIRECTORIES).not.toContain('.airo')
  })
})
