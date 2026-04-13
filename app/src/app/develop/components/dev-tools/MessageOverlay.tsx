'use client'

import React from 'react'
import Box from '@ux/box'

interface MessageOverlayProps {
  title: string
  message: string
  children: React.ReactNode
}

export default function MessageOverlay({
  title,
  message,
  children
}: MessageOverlayProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-intents-ux-boxHighContrastOverlay-backgroundColor backdrop-blur-sm rounded-lg rounded-b-none">
      <Box
        gap="lg"
        orientation="vertical"
        className="w-full max-w-3xl mx-2 md:mx-8 p-4 md:p-4 max-h-[80%] rounded-lg shadow-lg bg-intents-ux-box-backgroundColor"
      >
        <h2 className="text-2xl font-semibold text-intents-ux-text-color">
          {title}
        </h2>

        {message && (
          <pre className="leading-relaxed whitespace-pre-wrap opacity-75 p-2 bg-intents-ux-boxLowContrast-backgroundColor rounded-md max-h-full overflow-y-auto text-sm">
            {message}
          </pre>
        )}

        <div className="flex gap-4 justify-end flex-wrap">
          {children}
        </div>
      </Box>
    </div>
  )
}
