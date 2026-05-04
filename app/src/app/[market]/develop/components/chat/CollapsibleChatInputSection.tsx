'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { type ReactNode, useCallback, useId, useState } from 'react'
import ChevronDown from '@ux/icon/chevron-down'

export type CollapsibleChatInputSectionProps = {
  title: ReactNode
  children: ReactNode
  /** Shown below the animated body when expanded; omit for body-only sections (e.g. todo list). */
  footer?: ReactNode
  /** Content shown between title and chevron in the header row (e.g., progress count button) */
  headerRight?: ReactNode
  /** Controlled expanded state */
  expanded?: boolean
  /** Uncontrolled initial value */
  defaultExpanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  /** Optional test id for the outer wrapper */
  'data-testid'?: string
}

export function CollapseChevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronDown className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
  )
}

/**
 * Collapsible title row + animated body + optional footer for chat-input “decision” UIs.
 */
export default function CollapsibleChatInputSection({
  title,
  children,
  footer,
  headerRight,
  expanded: expandedProp,
  defaultExpanded = true,
  onExpandedChange,
  'data-testid': dataTestId,
}: CollapsibleChatInputSectionProps) {
  const sectionLabelId = useId()
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isControlled = expandedProp !== undefined
  const expanded = isControlled ? expandedProp : internalExpanded

  const setExpanded = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setInternalExpanded(next)
      }
      onExpandedChange?.(next)
    },
    [isControlled, onExpandedChange]
  )

  return (
    <div className="mb-0.5" data-testid={dataTestId}>
      <div className="flex min-h-[22px] items-center justify-between px-1 py-0.5">
        <span id={sectionLabelId} className="min-w-0 flex-1 text-sm font-medium text-muted-foreground">{title}</span>
        <div className="flex shrink-0 items-center gap-1">
          {headerRight}
          <button
            type="button"
            className="flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            onClick={() => setExpanded(!expanded)}
            aria-labelledby={sectionLabelId}
            aria-expanded={expanded}
          >
            <CollapseChevron expanded={expanded} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="collapsible-chat-input-section"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {children}
            {footer !== undefined && footer !== null ? <div className="mt-1 pb-2">{footer}</div> : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
