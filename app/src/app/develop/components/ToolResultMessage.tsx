'use client'

import { 
  FolderIcon, 
  DocumentTextIcon, 
  CodeBracketIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon
} from '@heroicons/react/24/outline'

interface ToolResultMessageProps {
  toolName: string
  toolResult: string
}

export default function ToolResultMessage({ toolName, toolResult }: ToolResultMessageProps) {
  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'directory_listing':
        return <FolderIcon className="w-4 h-4 text-blue-500" />
      case 'file_read':
      case 'read_file':
        return <DocumentTextIcon className="w-4 h-4 text-green-500" />
      case 'code_search':
      case 'grep_search':
        return <CodeBracketIcon className="w-4 h-4 text-purple-500" />
      case 'terminal':
      case 'run_command':
        return <CommandLineIcon className="w-4 h-4 text-orange-500" />
      default:
        return <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500" />
    }
  }

  const getToolDisplayName = (toolName: string) => {
    switch (toolName) {
      case 'directory_listing':
        return 'Directory Listing'
      case 'file_read':
      case 'read_file':
        return 'File Read'
      case 'code_search':
        return 'Code Search'
      case 'grep_search':
        return 'Text Search'
      case 'terminal':
      case 'run_command':
        return 'Terminal'
      default:
        return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }

  // Format the tool result for better display
  const formatToolResult = (result: string) => {
    // If it looks like a file/directory listing, preserve formatting
    if (result.includes('📁') || result.includes('📄')) {
      return result
    }
    
    // For other results, just return as-is for now
    return result
  }

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center space-x-2 px-3 py-2 bg-gray-100 border-b border-gray-200">
        {getToolIcon(toolName)}
        <span className="text-sm font-medium text-gray-700">
          {getToolDisplayName(toolName)}
        </span>
      </div>
      <div className="p-3">
        <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
          {formatToolResult(toolResult)}
        </pre>
      </div>
    </div>
  )
}
