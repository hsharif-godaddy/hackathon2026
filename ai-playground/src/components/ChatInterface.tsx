'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useWebSocketWithStore } from '@/hooks/useWebSocketWithStore'
import { useMessages, useCurrentStep, useMessageCount, type MessageSegment } from '@/stores/conversationStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  Conversation, 
  ConversationContent, 
  ConversationEmptyState,
  ConversationScrollButton 
} from '@/components/ai-elements/conversation'
import { Message, MessageContent } from '@/components/ai-elements/message'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { EnhancedPromptInput } from '@/components/EnhancedPromptInput'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { HTMLToolOutput } from '@/components/ai-elements/html-tool-output'
import { Response } from '@/components/ai-elements/response'
import { Loader } from '@/components/ai-elements/loader'
import { TrashIcon, BotIcon, UserIcon, WifiIcon, WifiOffIcon, FileIcon } from 'lucide-react'
import MessageMetadata from './MessageMetadata'

export default function ChatInterface() {
  const { 
    connected, 
    status, 
    sendMessage, 
    clearMessages 
  } = useWebSocketWithStore()
  
  const messages = useMessages()
  const currentStep = useCurrentStep()
  const messageCount = useMessageCount()

  const conversationRef = useRef<HTMLDivElement>(null)
  const [toolDisplayMode, setToolDisplayMode] = useState<'hidden' | 'status' | 'inline'>('inline')

  const scrollToBottom = () => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight
    }
  }

  // Auto-scroll when messages change or when AI is responding
  useEffect(() => {
    scrollToBottom()
  }, [messages, currentStep, status])

  const handleSendMessage = (message: string, files?: any[]) => {
    sendMessage(message, true, files) // Always use agentic mode, include files
    // Scroll to bottom when user sends a message
    setTimeout(scrollToBottom, 100)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const renderAttachedFiles = (attachedFiles: Array<{ name: string; size: number; type: string | null }>) => {
    if (!attachedFiles || attachedFiles.length === 0) return null

    return (
      <div className="mb-3 p-3 bg-muted/30 rounded-lg border">
        <div className="flex items-center gap-2 mb-2">
          <FileIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            {attachedFiles.length} attached file{attachedFiles.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {attachedFiles.map((file, index) => (
            <Badge key={index} variant="secondary" className="flex items-center gap-1">
              <span className="truncate max-w-[150px]">{file.name}</span>
              <span className="text-xs opacity-70">({formatFileSize(file.size)})</span>
            </Badge>
          ))}
        </div>
      </div>
    )
  }

  // Helper function to map tool status to ToolHeader state
  const getToolState = (toolCall: { status?: 'running' | 'completed' | 'error'; result?: Record<string, unknown> }) => {
    if (toolCall.status === 'running') return 'input-available' // Running state
    if (toolCall.status === 'error') return 'output-error' // Error state
    if (toolCall.result !== undefined) return 'output-available' // Completed state
    return 'input-available' // Default for tools without status (assume running)
  }

  const renderToolCall = (toolCall: {
    id?: string
    name: string
    input?: Record<string, unknown>
    result?: Record<string, unknown>
    status?: 'running' | 'completed' | 'error'
  }) => {
    if (toolDisplayMode === 'hidden') {
      return null
    }

    if (toolDisplayMode === 'status') {
      const isRunning = toolCall.status === 'running'
      const hasError = toolCall.status === 'error'
      const icon = isRunning ? '⏳' : hasError ? '❌' : '🛠️'
      
      return (
        <Badge 
          key={toolCall.id} 
          variant={hasError ? 'destructive' : isRunning ? 'default' : 'outline'} 
          className="text-xs inline-block mr-1 mb-1"
        >
          {icon} {toolCall.name}
        </Badge>
      )
    }

    // Inline mode - full details
    return (
      <div key={toolCall.id} className="my-3">
        <Tool defaultOpen={false}>
          <ToolHeader 
            type={`tool-${toolCall.name}` as `tool-${string}`}
            state={getToolState(toolCall)}
          />
          <ToolContent style={{ maxWidth: '80%' }}>
            <div className="space-y-4 max-w-full overflow-hidden">
              {toolCall.input && (
                <div className="max-w-full overflow-x-auto">
                  <ToolInput input={toolCall.input} />
                </div>
              )}
              {toolCall.result && (
                <>
                  <div className="max-w-full overflow-x-auto">
                    {toolCall.name === 'html_file_editor' ? (
                      <HTMLToolOutput 
                        output={toolCall.result} 
                        errorText={undefined}
                      />
                    ) : (
                      <ToolOutput 
                        output={toolCall.name === 'image_generator' ? 
                          // Filter out binary data for image generation results
                          Object.fromEntries(
                            Object.entries(toolCall.result as Record<string, unknown>).filter(([key, value]) => {
                              // Filter out images array and large strings that might be binary
                              if (key === 'images') return false
                              if (typeof value === 'string' && value.length > 1000) return false
                              return true
                            })
                          ) : 
                          toolCall.result
                        } 
                        errorText={undefined}
                      />
                    )}
                  </div>
                  {/* Special handling for image generation results */}
                  {toolCall.name === 'image_generator' && toolCall.result && typeof toolCall.result === 'object' && 'success' in toolCall.result && (toolCall.result as Record<string, unknown>).success && 'images' in toolCall.result && (
                    <div className="mt-4 space-y-3 max-w-full">
                      <div className="text-sm font-medium text-muted-foreground">Generated Images:</div>
                      <div className="grid grid-cols-1 gap-4 max-w-full">
                        {((toolCall.result as Record<string, unknown>).images as Array<{url?: string, base64?: string, revisedPrompt?: string}>).map((image, index) => (
                          <div key={index} className="space-y-2 max-w-full">
                            {/* Display the image - prefer URL, fallback to base64 */}
                            {(image.url || image.base64) && (
                              <div className="relative max-w-sm mx-auto">
                                <img 
                                  src={image.url || `data:image/png;base64,${image.base64}`} 
                                  alt={`Generated image ${index + 1}`}
                                  className="w-full h-auto rounded-lg border shadow-sm"
                                  loading="lazy"
                                  onError={(e) => {
                                    console.error('Failed to load image:', image.url ? 'URL' : 'base64')
                                    e.currentTarget.style.display = 'none'
                                  }}
                                />
                              </div>
                            )}
                            {/* Show image info */}
                            <div className="text-xs text-center text-muted-foreground">
                              {image.url ? 'Image URL' : 'Generated Image'} • {index + 1} of {((toolCall.result as Record<string, unknown>).images as Array<unknown>).length}
                            </div>
                            {/* Show revised prompt if available */}
                            {image.revisedPrompt && (
                              <div className="text-xs text-muted-foreground p-2 bg-muted rounded break-words max-w-full overflow-hidden">
                                <strong>Revised Prompt:</strong> {image.revisedPrompt}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </ToolContent>
        </Tool>
      </div>
    )
  }

  const renderMessageSegments = (segments: MessageSegment[]) => {
    if (!segments || segments.length === 0) return null

    // Group consecutive text segments together for proper markdown rendering
    const groupedSegments: Array<{type: 'text', content: string, id: string} | {type: 'tool', toolCall: {
      id?: string
      name: string
      input?: Record<string, unknown>
      result?: Record<string, unknown>
      status?: 'running' | 'completed' | 'error'
    }, id: string}> = []
    
    for (const segment of segments) {
      if (segment.type === 'text') {
        // If the last group is also text, combine them
        const lastGroup = groupedSegments[groupedSegments.length - 1]
        if (lastGroup && lastGroup.type === 'text') {
          lastGroup.content += segment.content
        } else {
          groupedSegments.push({
            type: 'text',
            content: segment.content,
            id: segment.id
          })
        }
      } else if (segment.type === 'tool') {
        groupedSegments.push({
          type: 'tool',
          toolCall: segment.toolCall,
          id: segment.id
        })
      }
    }

    return (
      <div className="space-y-3">
        {groupedSegments.map((group) => {
          if (group.type === 'text') {
            return (
              <Response key={group.id} className="prose prose-sm max-w-none">
                {group.content}
              </Response>
            )
          } else if (group.type === 'tool') {
            return renderToolCall({
              ...group.toolCall,
              status: group.toolCall.status as 'running' | 'completed' | 'error' | undefined
            })
          }
          return null
        })}
      </div>
    )
  }

  const renderToolCalls = (toolCalls: Array<{
    id?: string
    name: string
    input?: Record<string, unknown>
    result?: Record<string, unknown>
    status?: 'running' | 'completed' | 'error'
  }>) => {
    if (!toolCalls || toolCalls.length === 0) return null

    if (toolDisplayMode === 'hidden') {
      return null
    }

    if (toolDisplayMode === 'status') {
      return (
        <div className="mt-3 flex flex-wrap gap-1">
          {toolCalls.map((toolCall, index) => (
            <Badge key={toolCall.id || index} variant="outline" className="text-xs">
              🛠️ {toolCall.name}
            </Badge>
          ))}
        </div>
      )
    }

    // Inline mode - full details
    return (
      <div className="mt-3 space-y-2">
        {toolCalls.map((toolCall, index) => (
          <Tool key={toolCall.id || index} defaultOpen={false}>
            <ToolHeader 
              type={`tool-${toolCall.name}` as `tool-${string}`}
              state={getToolState(toolCall)}
            />
            <ToolContent>
              <div className="space-y-4 max-w-full overflow-hidden">
                {toolCall.input && (
                  <div className="max-w-full overflow-x-auto">
                    <ToolInput input={toolCall.input} />
                  </div>
                )}
                {toolCall.result && (
                  <div className="max-w-full overflow-x-auto">
                    <ToolOutput 
                      output={toolCall.result} 
                      errorText={undefined}
                    />
                  </div>
                )}
              </div>
            </ToolContent>
          </Tool>
        ))}
      </div>
    )
  }

  const getStatusBadge = () => {
    if (!connected) {
      return (
        <Badge variant="destructive" className="gap-1">
          <WifiOffIcon className="h-3 w-3" />
          Disconnected
        </Badge>
      )
    }

    const statusConfig = {
      idle: { variant: 'secondary' as const, text: 'Ready', icon: null },
      thinking: { variant: 'default' as const, text: 'Thinking...', icon: <Loader size={12} /> },
      processing: { variant: 'default' as const, text: 'Processing...', icon: <Loader size={12} /> },
      complete: { variant: 'secondary' as const, text: 'Complete', icon: null },
      error: { variant: 'destructive' as const, text: 'Error', icon: null },
    }

    const config = statusConfig[status]
    return (
      <Badge variant={config.variant} className="gap-1">
        {config.icon && config.icon}
        <WifiIcon className="h-3 w-3" />
        {config.text}
      </Badge>
    )
  }

  return (
    <div className="h-screen bg-muted/20 p-4 flex gap-4">
      {/* Status Panel */}
      <div className="w-64 bg-card rounded-xl shadow-lg border p-4 flex flex-col gap-4">
        {/* Title */}
        <div className="pb-3 border-b">
          <h1 className="text-xl font-semibold text-foreground">AI Playground</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Agentic AI with tools
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Connection Status</h3>
            {getStatusBadge()}
          </div>

          <div className="space-y-1">
            <h3 className="text-sm font-medium">Messages</h3>
            <div className="text-sm text-muted-foreground">
              {messageCount} total
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={clearMessages}
            disabled={messageCount === 0}
            className="gap-2 w-full"
          >
            <TrashIcon className="h-4 w-4" />
            Clear Chat
          </Button>
        </div>

        {/* Feature Controls */}
        <div className="space-y-3 pt-3 border-t">
          <h3 className="text-sm font-medium">Display Options</h3>
          
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Tool Calls</label>
            <Select value={toolDisplayMode} onValueChange={(value: 'hidden' | 'status' | 'inline') => setToolDisplayMode(value)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hidden">Hidden</SelectItem>
                <SelectItem value="status">Status Only</SelectItem>
                <SelectItem value="inline">Inline Details</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Current Step Indicator */}
        {currentStep && (status === 'thinking' || status === 'processing') && (
          <div className="rounded-md bg-muted/50 p-3 mt-auto">
            <div className="flex items-center gap-2 text-sm">
              <Loader size={14} />
              <span className="font-medium">Step {currentStep.step}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {currentStep.content.slice(0, 80)}
              {currentStep.content.length > 80 ? '...' : ''}
            </div>
            {currentStep.toolCalls && currentStep.toolCalls.length > 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                🛠️ {currentStep.toolCalls.map(t => t.name).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Chat Container */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 bg-card rounded-xl shadow-lg border flex flex-col min-h-0">
          {/* Conversation Area */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Conversation className="h-full">
              <div 
                ref={conversationRef}
                className="h-full overflow-y-auto max-h-full"
              >
                <ConversationContent className="px-6 py-4">
          {messageCount === 0 ? (
            <ConversationEmptyState
              icon={<BotIcon className="h-12 w-12 text-muted-foreground" />}
              title="Welcome to AI Playground"
              description="This playground demonstrates the AI SDK with your custom wrapper library using agentic mode for multi-step reasoning with tools."
            >
              <div className="mt-6 max-w-md rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
                <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                  Available Tools:
                </h3>
                <div className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                  <div>🧮 <strong>Calculator</strong> - Mathematical calculations</div>
                  <div>🌤️ <strong>Weather</strong> - Real-time weather via Open-Meteo API</div>
                  <div>📋 <strong>Task Planner</strong> - Break down complex tasks</div>
                  <div>🎨 <strong>Image Generator</strong> - Create images with DALL-E</div>
                  <div>🌐 <strong>HTML Editor</strong> - Create and edit websites with live preview</div>
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <Message key={message.id} from={message.role}>
                  <Avatar className="size-8 ring-1 ring-border">
                    <AvatarFallback className="bg-muted">
                      {message.role === 'user' ? (
                        <UserIcon className="h-4 w-4" />
                      ) : (
                        <BotIcon className="h-4 w-4" />
                      )}
                    </AvatarFallback>
                  </Avatar>
                  
                  <MessageContent variant="flat">
                    {/* Render attached files for user messages */}
                    {message.role === 'user' && message.metadata?.attachedFiles && 
                      renderAttachedFiles(message.metadata.attachedFiles)
                    }
                    
                    {/* Render chronological segments if available, otherwise fallback to legacy rendering */}
                    {message.segments && message.segments.length > 0 ? (
                      renderMessageSegments(message.segments)
                    ) : (
                      <>
                        {/* Legacy rendering: Main message content with markdown rendering */}
                        <Response className="prose prose-sm max-w-none">
                          {message.content}
                        </Response>
                        
                        {/* Legacy rendering: Tool calls */}
                        {renderToolCalls(message.toolCalls || [])}
                      </>
                    )}
                    
                    {/* Message metadata with cost calculation */}
                    <MessageMetadata 
                      timestamp={message.timestamp}
                      usage={message.usage}
                    />
                  </MessageContent>
                </Message>
              ))}
            </div>
          )}
                </ConversationContent>
              </div>
              <ConversationScrollButton />
            </Conversation>
          </div>

          {/* Input Area - Fixed to bottom */}
          <div className="border-t p-6 bg-card rounded-b-xl">
            <EnhancedPromptInput
              onSubmit={handleSendMessage}
              disabled={!connected}
              status={status}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}