import { hexSwatchBorderColor } from '@/app/[market]/develop/components/utils/hexSwatchBorder'
import { parseCommitMessageHex } from '@/app/[market]/develop/components/utils/parseCommitMessageHex'

interface CommitMessageWithSwatchesProps {
  message: string
}

export default function CommitMessageWithSwatches({ message }: CommitMessageWithSwatchesProps) {
  const segments = parseCommitMessageHex(message)
  const hasHex = segments.some((segment) => segment.type === 'hex')

  if (!hasHex) {
    return <>{message}</>
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.type === 'text' ? (
          <span key={`text-${index}`}>{segment.value}</span>
        ) : (
          <span key={`hex-${index}`} className="inline-flex items-center gap-[3px] align-middle">
            <span>{segment.value.toUpperCase()}</span>
            <span
              data-testid="commit-message-hex-swatch"
              aria-hidden
              title={segment.value}
              className="inline-block shrink-0 border align-middle"
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: segment.normalized,
                borderColor: hexSwatchBorderColor(segment.normalized),
              }}
            />
          </span>
        )
      )}
    </>
  )
}
