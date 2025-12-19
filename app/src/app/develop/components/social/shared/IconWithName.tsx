import { memo } from 'react'
import Box from '@ux/box'
import text from '@ux/text'

interface IconWithNameProps {
  Icon: React.ComponentType<{ className?: string }>
  name: string
}

export const IconWithName = memo(function IconWithName({
  Icon,
  name,
}: IconWithNameProps) {

  return (
    <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
      <Icon className='w-3 h-3 flex-shrink-0' />
      <text.span
        as="label"
        size={-1}
        text={name}
      />
    </Box>
  )
})
