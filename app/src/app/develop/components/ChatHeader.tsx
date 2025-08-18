'use client'

import { CodeBracketIcon } from '@heroicons/react/24/outline'

export default function ChatHeader() {
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
      </div>
    </div>
  )
}
