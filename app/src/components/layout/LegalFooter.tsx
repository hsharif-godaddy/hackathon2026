'use client'

import type { ReactElement } from 'react'
import { FormattedMessage } from 'react-intl'
import Box from '@ux/box'
import text from '@ux/text'

import { useBreakpoints } from '@/hooks/useBreakpoints'
import { useTranslations } from '@/hooks/useTranslations'

const LEGAL_LINKS = {
  cookies: 'https://www.godaddy.com/legal/agreements/cookie-policy',
  doNotSell: 'https://www.godaddy.com/legal/agreements/cookie-policy',
  legal: 'https://www.godaddy.com/legal/agreements',
  privacyPolicy: 'https://www.godaddy.com/legal/agreements/privacy-policy',
  universalTerms: 'https://www.godaddy.com/legal/agreements/universal-terms-of-service-agreement',
} as const

const linkClassName =
  'ux-text ux-text-size-2 opacity-80 hover:opacity-100 transition-opacity no-underline hover:underline whitespace-nowrap cursor-pointer'

const bodyTextClassName = 'opacity-80 m-0'

function FooterLink({
  href,
  label,
}: {
  href: string
  label: string
}): ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-version="2500"
      className={linkClassName}
    >
      {label}
    </a>
  )
}

function LegalNavLinks({ t }: { t: ReturnType<typeof useTranslations> }): ReactElement {
  return (
    <nav
      aria-label="Legal"
      className="flex flex-wrap justify-center gap-x-4 gap-y-2 lg:justify-end shrink-0"
    >
      <FooterLink href={LEGAL_LINKS.legal} label={t('builder_homepage_footer_legal')} />
      <FooterLink
        href={LEGAL_LINKS.privacyPolicy}
        label={t('builder_homepage_footer_privacy_policy')}
      />
      <FooterLink href={LEGAL_LINKS.cookies} label={t('builder_homepage_footer_cookies')} />
    </nav>
  )
}

function CopyrightText({
  alignClassName,
  text: copyright,
}: {
  alignClassName: string
  text: string
}): ReactElement {
  return (
    <text.p size={-2} className={`${bodyTextClassName} ${alignClassName}`}>
      {copyright}
    </text.p>
  )
}

function TermsText({
  alignClassName,
  t,
}: {
  alignClassName: string
  t: ReturnType<typeof useTranslations>
}): ReactElement {
  return (
    <text.p size={-2} className={`${bodyTextClassName} ${alignClassName}`}>
      <FormattedMessage
        id="builder_homepage_footer_terms"
        values={{
          terms_link: (
            <a
              href={LEGAL_LINKS.universalTerms}
              target="_blank"
              rel="noopener noreferrer"
              data-version="2500"
              className={linkClassName}
            >
              {t('builder_homepage_footer_universal_terms')}
            </a>
          ),
        }}
      />
    </text.p>
  )
}

function DoNotSellLink({ label }: { label: string }): ReactElement {
  return <FooterLink href={LEGAL_LINKS.doNotSell} label={label} />
}

export default function LegalFooter(): ReactElement {
  const t = useTranslations()
  const { isLgBreakpoint } = useBreakpoints()

  const copyright = t('builder_homepage_footer_copyright', { year: new Date().getFullYear() })

  return (
    <footer className="bg-[#1111111B] text-white/80">
      <Box className="px-3 sm:px-8 mx-auto py-4" gap="md">
        {!isLgBreakpoint ? (
          <Box gap="md" inlineAlignChildren="center">
            <LegalNavLinks t={t} />
            <DoNotSellLink label={t('builder_homepage_footer_do_not_sell')} />
            <CopyrightText alignClassName="text-center" text={copyright} />
            <TermsText alignClassName="text-center" t={t} />
          </Box>
        ) : (
          <Box gap="md" blockAlignChildren="start">
            <Box
              orientation="horizontal"
              inlineAlignChildren="start"
              blockAlignChildren="spaceBetween"
              gap="xl"
            >
              <CopyrightText alignClassName="text-left" text={copyright} />
              <LegalNavLinks t={t} />
            </Box>

            <Box orientation="horizontal" gap="xl" blockAlignChildren="spaceBetween">
              <TermsText alignClassName="text-left" t={t} />
              <DoNotSellLink label={t('builder_homepage_footer_do_not_sell')} />
            </Box>
          </Box>
        )}
      </Box>
    </footer>
  )
}
