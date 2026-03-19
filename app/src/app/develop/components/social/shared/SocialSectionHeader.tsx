'use client'

import clsx from 'clsx'
import { memo } from 'react'

import { IconWithName } from './IconWithName'

interface SocialSectionHeaderProps {
  Icon?: React.ComponentType<{ className?: string }> | null
  title?: string
  className?: string
}

export const SocialSectionHeader = memo(function SocialSectionHeader({
  Icon,
  title,
  className
}: SocialSectionHeaderProps) {
  if (!title || !Icon) {return null}

  return (
    <div className={clsx('mb-2', className)}>
      <IconWithName Icon={Icon} name={title} />
    </div>
  )
})
