'use client'

import { type ReactNode } from 'react'
import Tag from '@ux/tag'

interface StepProgressTagProps {
  current: number
  total: number
}

export default function StepProgressTag({ current, total }: StepProgressTagProps) {
  return (
    <Tag
      size="sm"
      emphasis="passive"
      className="shrink-0 !bg-intents-ux-boxLowContrast-backgroundColor !text-intents-ux-boxLowContrast-foregroundColor"
    >
      {`${current}/${total}`}
    </Tag>
  )
}

export function PanelSectionTitle({
  children,
  progress,
}: {
  children: ReactNode
  progress?: { current: number; total: number } | null
}) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span className="min-w-0 truncate">{children}</span>
      {progress && progress.total > 1 ? (
        <StepProgressTag current={progress.current} total={progress.total} />
      ) : null}
    </span>
  )
}
