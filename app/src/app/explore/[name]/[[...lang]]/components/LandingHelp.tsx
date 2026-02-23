'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import PageSection from '@/components/layout/PageSection'
import { LandingHelpData } from './types'

export default function LandingHelp({ title, text: bodyText, ctaText, ctaUrl }: LandingHelpData) {
  return (
    <PageSection>
      <Box
        className="max-w-screen-lg mx-auto bg-light-purple rounded-xl p-4 lg:p-10 mb-6 lg:mb-10"
        blockAlignChildren="start"
        inlineAlignChildren="start"
        gap="lg"
      >
        <text.h2 as="heading" size={3}>{title}</text.h2>
        <text.p
          className="max-w-screen-sm !font-thin"
          size={1}
        >
          {bodyText}
        </text.p>
        <Button
          external
          text={ctaText}
          design="primary"
          data-partial="inverted"
          href={ctaUrl}
        />
      </Box>
    </PageSection>
  )
}
