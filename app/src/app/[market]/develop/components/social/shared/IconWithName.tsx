import { memo } from 'react'
import Box from '@ux/box'
import text from '@ux/text'

interface IconWithNameProps {
  Icon: React.ComponentType<{ className?: string }>
  name: string
  className?: string
}

export const IconWithName = memo(function IconWithName({
  Icon,
  name,
  className,
}: IconWithNameProps) {

  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center" className={className}>
      <Icon className="w-3 h-3 flex-shrink-0" />
      <text.span
        as="title"
        size={-1}
        text={name}
      />
    </Box>
  )
})
