/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logLogoDesignerEntry } from './logo-designer-entry'

const mockShipAnalyticsLog = vi.fn()

vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: (...args: unknown[]) => mockShipAnalyticsLog(...args),
}))

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', {
    value,
    writable: true,
    configurable: true,
  })
}

describe('logLogoDesignerEntry', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()

    Object.defineProperty(window, 'location', {
      value: { origin: 'https://app.example.com', pathname: '/en-US', search: '', hash: '' },
      writable: true,
    })
    setReferrer('')
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })

  it('fires the unified event with the given source, template, and page', () => {
    window.location.pathname = '/en-US/apps'

    logLogoDesignerEntry('chip')

    expect(mockShipAnalyticsLog).toHaveBeenCalledTimes(1)
    expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
      'homepage.logo_designer.entry',
      expect.objectContaining({ entrySource: 'chip', template: 'logo-designer', page: '/en-US/apps' }),
    )
  })

  it('captures referrer and all source params for attribution', () => {
    window.location.search =
      '?template=logo-designer&site_location=blog&location=hero&itc=promo123' +
      '&utm_source=newsletter&utm_medium=email&utm_campaign=spring&utm_term=logo&utm_content=cta'
    setReferrer('https://www.godaddy.com/')

    logLogoDesignerEntry('deeplink')

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('homepage.logo_designer.entry', {
      entrySource: 'deeplink',
      template: 'logo-designer',
      page: '/en-US',
      referrer: 'https://www.godaddy.com/',
      selfReferral: false,
      siteLocation: 'blog',
      location: 'hero',
      itc: 'promo123',
      utmSource: 'newsletter',
      utmMedium: 'email',
      utmCampaign: 'spring',
      utmTerm: 'logo',
      utmContent: 'cta',
    })
  })

  it('leaves missing attribution fields undefined', () => {
    logLogoDesignerEntry('suggestion')

    expect(mockShipAnalyticsLog).toHaveBeenCalledWith('homepage.logo_designer.entry', {
      entrySource: 'suggestion',
      template: 'logo-designer',
      page: '/en-US',
      referrer: undefined,
      selfReferral: true,
      siteLocation: undefined,
      location: undefined,
      itc: undefined,
      utmSource: undefined,
      utmMedium: undefined,
      utmCampaign: undefined,
      utmTerm: undefined,
      utmContent: undefined,
    })
  })

  describe('selfReferral', () => {
    it('is true when there is no referrer', () => {
      setReferrer('')

      logLogoDesignerEntry('deeplink')

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'homepage.logo_designer.entry',
        expect.objectContaining({ selfReferral: true }),
      )
    })

    it('is true when the referrer is same-origin (e.g. a reload after chip select)', () => {
      setReferrer('https://app.example.com/en-US?template=logo-designer')

      logLogoDesignerEntry('deeplink')

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'homepage.logo_designer.entry',
        expect.objectContaining({ selfReferral: true }),
      )
    })

    it('is false for an external inbound referrer', () => {
      setReferrer('https://www.godaddy.com/')

      logLogoDesignerEntry('deeplink')

      expect(mockShipAnalyticsLog).toHaveBeenCalledWith(
        'homepage.logo_designer.entry',
        expect.objectContaining({ selfReferral: false }),
      )
    })
  })
})
