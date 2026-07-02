/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { renderWithProviders } from '@/tests/test-utils'
import LegalFooter from './LegalFooter'

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: vi.fn(),
}))

vi.mock('react-intl', async () => {
  const actual = await vi.importActual<typeof import('react-intl')>('react-intl')
  return {
    ...actual,
    FormattedMessage: ({
      id,
      values,
    }: {
      id: string
      values?: { terms_link?: ReactNode }
    }) => (
      <>
        {id}
        {values?.terms_link}
      </>
    ),
  }
})

const LEGAL_URL = 'https://www.godaddy.com/legal/agreements'
const PRIVACY_URL = 'https://www.godaddy.com/legal/agreements/privacy-policy'
const COOKIES_URL = 'https://www.godaddy.com/legal/agreements/cookie-policy'
const UNIVERSAL_TERMS_URL =
  'https://www.godaddy.com/legal/agreements/universal-terms-of-service-agreement'
const DO_NOT_SELL_URL = 'https://www.godaddy.com/legal/agreements/cookie-policy'

function mockLgBreakpoint(isLgBreakpoint: boolean) {
  vi.mocked(useBreakpoints).mockReturnValue({
    isBelowSmBreakpoint: false,
    isSmBreakpoint: true,
    isMdBreakpoint: true,
    isLgBreakpoint,
    isXlBreakpoint: isLgBreakpoint,
  })
}

function expectExternalLink(name: string, href: string) {
  const link = screen.getByRole('link', { name })
  expect(link).toHaveAttribute('href', href)
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
}

describe('LegalFooter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('legal links', () => {
    it('should render each footer link with the correct href and external attrs', () => {
      mockLgBreakpoint(true)
      renderWithProviders(<LegalFooter />)

      expectExternalLink('builder_homepage_footer_legal', LEGAL_URL)
      expectExternalLink('builder_homepage_footer_privacy_policy', PRIVACY_URL)
      expectExternalLink('builder_homepage_footer_cookies', COOKIES_URL)
      expectExternalLink('builder_homepage_footer_do_not_sell', DO_NOT_SELL_URL)
    })
  })

  describe('terms', () => {
    it('should render the terms i18n key with the universal terms link', () => {
      mockLgBreakpoint(true)
      renderWithProviders(<LegalFooter />)

      expect(screen.getByText('builder_homepage_footer_terms')).toBeInTheDocument()
      expectExternalLink('builder_homepage_footer_universal_terms', UNIVERSAL_TERMS_URL)
    })
  })

  describe('copyright', () => {
    it('should render the copyright i18n key', () => {
      mockLgBreakpoint(true)
      renderWithProviders(<LegalFooter />)

      expect(screen.getByText('builder_homepage_footer_copyright')).toBeInTheDocument()
    })
  })

  describe('mobile layout', () => {
    it('should render nav links before copyright when below lg breakpoint', () => {
      mockLgBreakpoint(false)
      renderWithProviders(<LegalFooter />)

      const legalLink = screen.getByRole('link', { name: 'builder_homepage_footer_legal' })
      const copyright = screen.getByText('builder_homepage_footer_copyright')

      expect(
        legalLink.compareDocumentPosition(copyright) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })

  describe('desktop layout', () => {
    it('should render copyright before nav links at lg breakpoint', () => {
      mockLgBreakpoint(true)
      renderWithProviders(<LegalFooter />)

      const legalLink = screen.getByRole('link', { name: 'builder_homepage_footer_legal' })
      const copyright = screen.getByText('builder_homepage_footer_copyright')

      expect(
        copyright.compareDocumentPosition(legalLink) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })
})
