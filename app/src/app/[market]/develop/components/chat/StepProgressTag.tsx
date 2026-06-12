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
  /**
   * When true, the title wraps across lines instead of truncating to a single
   * line with an ellipsis. Use for long, user-facing text (e.g. askQuestion
   * prompts) where the full text must remain readable. Defaults to false to
   * preserve the compact single-line behavior for short static titles.
   */
  multiline = false,
}: {
  children: ReactNode
  progress?: { current: number; total: number } | null
  multiline?: boolean
}) {
  return (
    <span
      className={`inline-flex gap-1.5 min-w-0 max-w-full ${multiline ? 'items-start' : 'items-center'}`}
    >
      <span className={multiline ? 'min-w-0 whitespace-normal break-words' : 'min-w-0 truncate'}>
        {children}
      </span>
      {progress && progress.total > 1 ? (
        <StepProgressTag current={progress.current} total={progress.total} />
      ) : null}
    </span>
  )
}
