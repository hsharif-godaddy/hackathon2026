'use client'

import {
  FolderIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  PhotoIcon
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
      case 'image_search':
        return <PhotoIcon className="w-4 h-4 text-pink-500" />
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
      case 'image_search':
        return 'Image Search'
      default:
        return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }

  const extractImageFromResult = (toolResult: string) => {
    // Match markdown image format: ![alt text](image_url)
    const imageMatch = toolResult.match(/!\[([^\]]*)\]\(([^\)]+)\)/)
    if (imageMatch) {
      return {
        alt: imageMatch[1],
        url: imageMatch[2]
      }
    }
    return null
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
        {toolName === 'image_search' ? (
          <div className="space-y-2">
            {(() => {
              const imageData = extractImageFromResult(toolResult)
              if (imageData) {
                return (
                  <div>
                    <img
                      src={imageData.url}
                      alt={imageData.alt || 'Search result image'}
                      className="max-w-full h-auto max-h-64 rounded shadow-sm mb-2"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement
                        target.style.display = 'none'
                        const fallback = target.nextSibling as HTMLElement
                        if (fallback) fallback.style.display = 'block'
                      }}
                    />
                    <div className="text-xs text-red-600 hidden">
                      Failed to load image: {imageData.url}
                    </div>
                    <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed">
                      {toolResult}
                    </pre>
                  </div>
                )
              }
              return (
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                  {formatToolResult(toolResult)}
                </pre>
              )
            })()
            }
          </div>
        ) : (
          <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
            {formatToolResult(toolResult)}
          </pre>
        )}
      </div>
    </div>
  )
}
