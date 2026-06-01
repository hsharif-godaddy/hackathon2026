import { getMentionTagIcon, getMentionTagLabel, MentionChip } from '@airo-ux/pattern-library/primitives/mention-chip'

import type { ParsedElementMention } from '@/app/[market]/develop/components/chat/parseElementMentions'
import { cn } from '@/lib/utils'

interface ElementMentionChipListProps {
  mentions: ParsedElementMention[]
  className?: string
}

export default function ElementMentionChipList({ mentions, className }: ElementMentionChipListProps) {
  if (mentions.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap gap-0.5 text-xs mb-1', className)}>
      {mentions.map((mention, index) => (
        <MentionChip
          key={`${mention.tag}-${index}`}
          icon={getMentionTagIcon(mention.tag)}
          label={getMentionTagLabel(mention.tag)}
          className="!mx-0"
        />
      ))}
    </div>
  )
}
