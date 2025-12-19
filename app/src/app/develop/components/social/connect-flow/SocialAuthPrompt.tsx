'use client'

import { memo } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

interface SocialAuthPromptProps {
  platformName: string
  onConnect: () => void
}

export const SocialAuthPrompt = memo(function SocialAuthPrompt({
  platformName,
  onConnect
}: SocialAuthPromptProps) {
    return (
      <Box orientation="vertical" gap="md">
      <text.span as="paragraph" emphasis="info" size={-2} text="A popup will open for authentication. Please complete the authentication flow in the popup to establish the connection." />
      <text.span as="paragraph" emphasis="passive" size={-2} text="If you don't see the popup, use this button:" />
      <Button design="primary" size="sm" onClick={onConnect} text={`Connect ${platformName}`} />
    </Box>
  )
})
