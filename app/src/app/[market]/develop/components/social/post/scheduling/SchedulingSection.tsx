
'use client'

import { memo } from 'react'

import { PublishTiming } from '@/types/social-posts'
import { SchedulingView } from './SchedulingView'

interface PlatformSchedulingSectionProps {
  timing: PublishTiming
  date: string[]
  time: string
  onTimingChange: (timing: PublishTiming) => void
  onScheduleChange: (schedule: { date?: string[]; time?: string }) => void
}

export const SchedulingSection = memo(({
  timing,
  date,
  time,
  onTimingChange,
  onScheduleChange
}: PlatformSchedulingSectionProps) => {
  return (
    <SchedulingView
      timing={timing}
      date={date}
      time={time}
      onTimingChange={onTimingChange}
      onDateChange={(date) => onScheduleChange({ date })}
      onTimeChange={(time) => onScheduleChange({ time })}
    />
  )
})

SchedulingSection.displayName = 'SchedulingSection'
