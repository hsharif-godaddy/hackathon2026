import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import PageSection from '@/components/layout/PageSection'
import { useTranslations } from '@/hooks/useTranslations'

export default function HelpSection() {
  const t = useTranslations();
  return(
    <PageSection>
      <Box
        className="max-w-screen-lg mx-auto bg-light-purple rounded-xl p-6 lg:p-10 mb-6 lg:mb-10"
        blockAlignChildren="start"
        inlineAlignChildren="start"
        gap="lg"
      >
        <text.h2 as="heading" size={3}>{t('builder_homepage_help_title')}</text.h2>
        <text.p
          className="max-w-screen-sm !font-thin"
          size={1}
        >
         {t('builder_homepage_help_text', { phone: <a href={`tel:${t('builder_help_phone')}`}>{t('builder_help_phone')}</a> })}
        </text.p>
        <Button
          external
          text={t('builder_homepage_help_cta')}
          design="primary"
          data-partial="inverted"
          href="https://www.godaddy.com/help/contact-us"
        />
      </Box>
    </PageSection>
  )
}
