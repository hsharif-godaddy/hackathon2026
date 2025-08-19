'use client'

import { useState } from 'react'
import { 
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FolderIcon, 
  DocumentTextIcon, 
  CodeBracketIcon,
  CommandLineIcon,
  WrenchScrewdriverIcon
} from '@heroicons/react/24/outline'

interface ToolCallMessageProps {
  toolName: string
  toolStatus: 'running' | 'success' | 'error'
  duration?: number
  toolResult?: string
  error?: string
  toolArgs?: string
}

export default function ToolCallMessage({ 
  toolName, 
  toolStatus, 
  duration, 
  toolResult, 
  error,
  toolArgs 
}: ToolCallMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getToolIcon = (toolName: string) => {
    switch (toolName) {
      case 'directory_listing':
        return <FolderIcon className="w-4 h-4" />
      case 'file_read':
      case 'read_file':
        return <DocumentTextIcon className="w-4 h-4" />
      case 'file_edit':
        return <DocumentTextIcon className="w-4 h-4" />
      case 'code_search':
      case 'codebase_search':
      case 'grep_search':
        return <CodeBracketIcon className="w-4 h-4" />
      case 'terminal':
      case 'run_command':
      case 'run_terminal_cmd':
        return <CommandLineIcon className="w-4 h-4" />
      default:
        return <WrenchScrewdriverIcon className="w-4 h-4" />
    }
  }

  const getToolDisplayName = (toolName: string) => {
    switch (toolName) {
      case 'directory_listing':
        return 'Directory Listing'
      case 'file_read':
      case 'read_file':
        return 'Read File'
      case 'file_edit':
        return 'File Edit'
      case 'code_search':
      case 'codebase_search':
        return 'Code Search'
      case 'grep_search':
        return 'Text Search'
      case 'terminal':
      case 'run_command':
      case 'run_terminal_cmd':
        return 'Terminal'
      default:
        return toolName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    }
  }

  const getStatusIcon = () => {
    switch (toolStatus) {
      case 'running':
        return <ClockIcon className="w-4 h-4 text-blue-500 animate-spin" />
      case 'success':
        return <CheckCircleIcon className="w-4 h-4 text-green-500" />
      case 'error':
        return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatArgs = (args?: string) => {
    if (!args) return ''
    try {
      const parsed = JSON.parse(args)
      return JSON.stringify(parsed, null, 2)
    } catch {
      return args
    }
  }

  const getFileName = (toolName: string, args?: string) => {
    if ((toolName === 'file_edit' || toolName === 'file_read' || toolName === 'read_file') && args) {
      try {
        const parsed = JSON.parse(args)
        const fullPath = parsed.path || parsed.target_file || null
        if (fullPath) {
          // Extract just the filename from the path
          return fullPath.split('/').pop() || fullPath
        }
        return null
      } catch {
        return null
      }
    }
    return null
  }

  const filename = getFileName(toolName, toolArgs)
  const hasOutput = Boolean(toolResult || error)

  return (
    <div className="space-y-1">
      {/* Header */}
      <div 
        className={`flex items-center justify-between py-1 ${hasOutput ? 'cursor-pointer hover:opacity-70' : ''}`}
        onClick={hasOutput ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            {getToolIcon(toolName)}
            {getStatusIcon()}
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-700">
              {getToolDisplayName(toolName)}
              {filename && (
                <span className="text-xs text-gray-500 ml-1 font-mono">
                  {filename}
                </span>
              )}
            </span>
            {toolStatus === 'running' && (
              <span className="text-xs text-gray-500">
                executing...
              </span>
            )}
            {toolStatus !== 'running' && duration && (
              <span className="text-xs text-gray-500">
                {formatDuration(duration)}
              </span>
            )}
          </div>
        </div>
        
        {hasOutput && (
          <div className="flex items-center space-x-1">
            {toolStatus === 'error' && (
              <span className="text-xs text-red-600">failed</span>
            )}
            {toolStatus === 'success' && (
              <span className="text-xs text-green-600">done</span>
            )}
            {isExpanded ? (
              <ChevronDownIcon className="w-3 h-3 text-gray-400" />
            ) : (
              <ChevronRightIcon className="w-3 h-3 text-gray-400" />
            )}
          </div>
        )}
      </div>

      {/* Expandable content */}
      {isExpanded && hasOutput && (
        <div className="ml-6 mt-2 space-y-2">
          {/* Tool arguments (if available) */}
          {toolArgs && (
            <div>
              <div className="text-xs text-gray-500 mb-1">Arguments:</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono bg-gray-50 p-2 rounded text-left max-h-32 overflow-y-auto">
                {formatArgs(toolArgs)}
              </pre>
            </div>
          )}
          
          {/* Tool output */}
          <div>
            <div className="text-xs text-gray-500 mb-1">
              {error ? 'Error:' : 'Output:'}
            </div>
            <pre className={`text-xs whitespace-pre-wrap font-mono max-h-64 overflow-y-auto p-2 rounded text-left ${
              error ? 'text-red-700 bg-red-50' : 'text-gray-600 bg-gray-50'
            }`}>
              {error || toolResult}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
