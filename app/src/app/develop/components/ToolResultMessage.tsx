'use client'

import {
  FolderIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon,
  PhotoIcon
} from '@heroicons/react/24/outline'
import { getToolDisplayName } from '../../../utils/toolNameMapping'

interface ToolResultMessageProps {
  toolName: string
  toolResult: string
}

export default function ToolResultMessage({ toolName, toolResult }: ToolResultMessageProps) {
  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'directory_listing':
        return <FolderIcon className="w-2 h-2 text-blue-500" />
      case 'file_read':
      case 'read_file':
        return <DocumentTextIcon className="w-2 h-2 text-green-500" />
      case 'code_search':
      case 'grep_search':
        return <CodeBracketIcon className="w-2 h-2 text-purple-500" />
      case 'terminal':
      case 'run_command':
        return <CommandLineIcon className="w-2 h-2 text-orange-500" />
      case 'image_search':
        return <PhotoIcon className="w-2 h-2 text-pink-500" />
      default:
        return <WrenchScrewdriverIcon className="w-2 h-2 text-gray-500" />
    }
  }


  const extractImagesFromResult = (toolResult: string) => {
    // Match all markdown image formats: ![alt text](image_url)
    const imageMatches = toolResult.matchAll(/!\[([^\]]*)\]\(([^\)]+)\)/g)
    const images = []

    for (const match of imageMatches) {
      images.push({
        alt: match[1] || 'Search result image',
        url: match[2]
      })
    }

    return images.length > 0 ? images : null
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
    <div className="bg-gray-50 border rounded-lg overflow-hidden">
      <div className="flex items-center space-x-1 px-1.5 py-1 border-b">
        {getToolIcon(toolName)}
        <span className="text-sm font-medium text-gray-700">
          {getToolDisplayName(toolName)}
        </span>
      </div>
      <div className="p-1.5">
        {toolName === 'image_search' ? (
          <div className="space-y-2">
            {(() => {
              const images = extractImagesFromResult(toolResult)
              if (images && images.length > 0) {
                return (
                  <div className="space-y-2">
                    {/* Image grid for multiple images */}
                    <div className={`grid gap-3 ${images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : images.length === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
                      {images.map((imageData, index) => (
                        <div key={index} className="space-y-1">
                          <img // eslint-disable-line @next/next/no-img-element
                            src={imageData.url}
                            alt={imageData.alt}
                            className="w-full h-auto max-h-48 object-cover rounded-lg shadow-sm border"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.style.display = 'none'
                              const fallback = target.nextSibling as HTMLElement
                              if (fallback) fallback.style.display = 'block'
                            }}
                          />
                          <div className="text-xs text-red-600 hidden p-1 bg-red-50 rounded border border-red-200">
                            Failed to load image: {imageData.alt}
                          </div>
                          {imageData.alt && (
                            <p className="text-xs text-gray-600 font-medium text-center">
                              {imageData.alt}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Show raw markdown for reference */}
                    <details className="mt-2">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                        Show raw markdown ({images.length} image{images.length !== 1 ? 's' : ''})
                      </summary>
                      <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed mt-1 p-1 bg-gray-50 rounded border">
                        {toolResult}
                      </pre>
                    </details>
                  </div>
                )
              }
              return (
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {formatToolResult(toolResult)}
                </pre>
              )
            })()
            }
          </div>
        ) : (
          <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
            {formatToolResult(toolResult)}
          </pre>
        )}
      </div>
    </div>
  )
}
