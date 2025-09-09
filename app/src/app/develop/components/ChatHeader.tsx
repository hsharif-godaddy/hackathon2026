'use client'

import { CodeBracketIcon, ClockIcon } from '@heroicons/react/24/outline'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

interface ChatHeaderProps {
  onToggleVersionHistory: () => void
  isVersionHistoryOpen: boolean
  hasSelectedCommit: boolean
}

export default function ChatHeader({ onToggleVersionHistory, isVersionHistoryOpen, hasSelectedCommit }: ChatHeaderProps) {
  return (
    <div className="border-b border-gray-200 px-4 py-3 bg-white">
      <Box 
        orientation="horizontal" 
        blockAlignChildren="spaceBetween" 
        inlineAlignChildren="center"
        gap="md"
      >
        <Box orientation="horizontal" gap="md" inlineAlignChildren="center">
          <Box 
            className="w-8 h-8 flex items-center justify-center"
            rounding="reduced"
            data-partial="gradientAiro"
            style={{
              background: "var(--ux-cao06b)",
            }}
          >
            <CodeBracketIcon className="w-4 h-4 text-ai" />
          </Box>
          <Box className="leading-none">
            <text.strong 
              size={ -1 } 
              className="text-sm"
            >
              CodeBot-DEV
            </text.strong>
            <p className="text-xs">Lead Developer Agent</p>
          </Box>
        </Box>
        <Button 
          onClick={onToggleVersionHistory}
          className={`ml-auto ${
            isVersionHistoryOpen || hasSelectedCommit
              ? 'bg-amber-100 text-amber-700' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          title="Version History"
          design="control"
          icon={<ClockIcon className="w-4 h-4" />}
          size="sm"
        />
      </Box>
    </div>
  )
}