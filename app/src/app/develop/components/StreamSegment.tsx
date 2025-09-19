'use client'

import MarkdownRenderer from './MarkdownRenderer'
import type { StreamSegment as StreamSegmentType } from './streamingConversationStore'

interface StreamSegmentProps {
  segment: StreamSegmentType
}

export default function StreamSegment({ segment }: StreamSegmentProps) {
  switch (segment.type) {
    case 'text':
      return (
        <span className="inline">
          <MarkdownRenderer content={segment.content} />
        </span>
      )
    
    case 'tool_start':
      return (
        <div className="my-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-blue-800">
              🔧 Starting {segment.toolCall?.name}...
            </span>
          </div>
          
          {/* Show tool input if available */}
          {segment.toolCall?.input && Object.keys(segment.toolCall.input).length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-blue-600 mb-1">Input:</div>
              <pre className="text-xs bg-white p-2 rounded border overflow-x-auto">
                {JSON.stringify(segment.toolCall.input, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )
    
    case 'tool_result':
      return (
        <div className="my-2 p-2 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm font-medium text-green-800">
              ✅ {segment.toolCall?.name} completed
            </span>
            {segment.toolCall?.status === 'error' && (
              <span className="text-xs px-2 py-1 bg-red-100 text-red-800 rounded">
                Error
              </span>
            )}
          </div>
          
          {/* Show tool result */}
          {segment.toolCall?.result && (
            <div>
              <div className="text-xs text-green-600 mb-1">Result:</div>
              <div className="text-sm bg-white p-2 rounded border max-h-32 overflow-y-auto">
                {typeof segment.toolCall.result === 'string' 
                  ? segment.toolCall.result 
                  : JSON.stringify(segment.toolCall.result, null, 2)
                }
              </div>
            </div>
          )}
          
          {/* Show error if any */}
          {segment.toolCall?.error && (
            <div className="mt-2">
              <div className="text-xs text-red-600 mb-1">Error:</div>
              <div className="text-sm bg-red-50 p-2 rounded border text-red-800">
                {segment.toolCall.error}
              </div>
            </div>
          )}
          
          {/* Show timing if available */}
          {segment.toolCall?.startTime && segment.toolCall?.endTime && (
            <div className="text-xs text-gray-500 mt-2">
              Duration: {new Date(segment.toolCall.endTime).getTime() - new Date(segment.toolCall.startTime).getTime()}ms
            </div>
          )}
        </div>
      )
    
    default:
      return (
        <span className="text-gray-500 text-sm">
          [Unknown segment type: {segment.type}]
        </span>
      )
  }
}
