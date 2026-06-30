'use client'

import { type RefObject } from 'react'
import text from '@ux/text'
import Tooltip from '@ux/tooltip'

interface HeaderTooltipProps {
  anchorRef: RefObject<HTMLElement | null>
  label: string
  description?: React.ReactNode
}

export function HeaderTooltip({ anchorRef, label, description }: HeaderTooltipProps) {
  return (
    <Tooltip anchorRef={anchorRef} portalElem={document.body} className="z-50 develop-header-tooltip">
      <div className="flex flex-col gap-0">
        <text.div as="paragraph" size={-1} text={label} className="font-bold" />
        {description && (
          <text.div as="paragraph" size={-2} text={description} />
        )}
      </div>
    </Tooltip>
  )
}
