'use client'

import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'
import CodeBracketIcon from '@ux/icon/code'
import HistoryIcon from '@ux/icon/history'

interface ChatHeaderProps {
  onToggleVersionHistory: () => void
  isVersionHistoryOpen: boolean
  hasSelectedCommit: boolean
}

export default function ChatHeader({ onToggleVersionHistory, isVersionHistoryOpen, hasSelectedCommit }: ChatHeaderProps) {
  return (
    <div className="border-b px-4 py-3">
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
          title="Version History"
          design="control"
          active={isVersionHistoryOpen || hasSelectedCommit}
          icon={<HistoryIcon className="w-4 h-4" />}
          size="sm"
        />
      </Box>
    </div>
  )
}