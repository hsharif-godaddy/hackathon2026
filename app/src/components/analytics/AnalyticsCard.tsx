import type { ReactNode } from 'react'
import Box, { type BoxProps } from '@ux/box'
import TextLockup from '@ux/text-lockup'

export interface AnalyticsTextLockupProps {
  title?: ReactNode
  description?: ReactNode
}

export function AnalyticsTextLockup({ title, description }: AnalyticsTextLockupProps) {
  if (!title && !description) {
    return null
  }
  return (
    <TextLockup
      title={title ? <div className="flex items-center gap-1">{title}</div> : undefined}
      size="xs"
    >
      {description ? (
        <span className="text-intents-ux-feedbackHighContrastPassive-feedbackColor">
          {description}
        </span>
      ) : null}
    </TextLockup>
  )
}

interface AnalyticsCardProps extends Omit<BoxProps, 'title' | 'description'> {
  title?: ReactNode
  description?: ReactNode
  children?: ReactNode
}

/**
 * Shared card wrapper for analytics widgets.
 *
 * Uses the UXCore Box primitive with card elevation so all analytics widgets
 * share the same container styling, title, and description treatment.
 */
export function AnalyticsCard({
  title,
  description,
  children,
  className,
  ...boxProps
}: AnalyticsCardProps) {
  return (
    <Box
      elevation="card"
      gap="md"
      blockPadding="md"
      inlinePadding="md"
      className={className}
      {...boxProps}
    >
      <AnalyticsTextLockup title={title} description={description} />
      {children}
    </Box>
  )
}
