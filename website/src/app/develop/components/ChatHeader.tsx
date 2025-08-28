'use client'

import { CodeBracketIcon, ClockIcon } from '@heroicons/react/24/outline'

interface ChatHeaderProps {
  onToggleVersionHistory: () => void
  isVersionHistoryOpen: boolean
  hasSelectedCommit: boolean
}

export default function ChatHeader({ onToggleVersionHistory, isVersionHistoryOpen, hasSelectedCommit }: ChatHeaderProps) {
  return (
    <div className="border-b border-gray-200 px-4 py-3 bg-white">
      <div className="flex items-center">
        <div className="w-8 h-8 bg-gradient-to-r from-green-100 to-emerald-100 rounded-lg flex items-center justify-center mr-3">
          <CodeBracketIcon className="w-4 h-4 text-green-600" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">CodeBot-DEV</h2>
          <p className="text-xs text-green-600">Lead Developer Agent</p>
        </div>
        <button 
          onClick={onToggleVersionHistory}
          className={`flex items-center justify-center ml-auto w-6 h-6 rounded transition-colors ${
            isVersionHistoryOpen || hasSelectedCommit
              ? 'bg-amber-100 text-amber-700' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          title="Version History"
        >
          <ClockIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
