'use client'

import PageIcon from '@ux/icon/page'
import text from '@ux/text'

import { cn } from '@/lib/utils'

interface FileReferenceBadgeProps {
  file: {
    path: string
    content: string
  }
  className?: string
}

function getFilename(path: string): string {
  return path.split('/').pop() || path
}

export default function FileReferenceBadge({ file, className }: FileReferenceBadgeProps) {
  const filename = getFilename(file.path)

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor',
        className
      )}
    >
      <PageIcon className="size-3 flex-shrink-0" />
      <text.span as="caption" size={-1} className="truncate max-w-[120px]">
        {filename}
      </text.span>
    </div>
  )
}

interface FileReferenceListProps {
  files: Array<{ path: string; content: string }>
  className?: string
}

export function FileReferenceList({ files, className }: FileReferenceListProps) {
  if (files.length === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-wrap gap-1 mt-1', className)}>
      {files.map((file, index) => (
        <FileReferenceBadge key={`${file.path}-${index}`} file={file} />
      ))}
    </div>
  )
}
