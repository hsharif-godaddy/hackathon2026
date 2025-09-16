'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { SendIcon, Loader2Icon } from 'lucide-react'
import { ExamplePrompts } from './ExamplePrompts'

interface CustomPromptInputProps {
  onSubmit: (message: string) => void
  disabled?: boolean
  status: 'idle' | 'thinking' | 'processing' | 'complete' | 'error'
  className?: string
}

export function CustomPromptInput({ 
  onSubmit, 
  disabled = false, 
  status,
  className 
}: CustomPromptInputProps) {
  const [message, setMessage] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (message.trim() && !disabled && status !== 'thinking' && status !== 'processing') {
      onSubmit(message.trim())
      setMessage('')
    }
  }

  const isProcessing = status === 'thinking' || status === 'processing'

  return (
    <div className={cn("space-y-3", className)}>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ask me to solve a complex problem..."
            className="min-h-[60px] max-h-[120px] resize-none pr-12"
            disabled={disabled || isProcessing}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
            }}
          />
          {isProcessing && (
            <div className="absolute inset-0 bg-background/80 rounded-md flex items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                <span>
                  {status === 'thinking' ? 'AI is thinking...' : 'Processing...'}
                </span>
              </div>
            </div>
          )}
        </div>

        <Button
          type="submit"
          disabled={!message.trim() || disabled || isProcessing}
          size="icon"
          className="self-end h-[60px] w-12"
        >
          {isProcessing ? (
            <Loader2Icon className="h-4 w-4 animate-spin" />
          ) : (
            <SendIcon className="h-4 w-4" />
          )}
        </Button>
      </form>

      {/* Example Prompts */}
      <ExamplePrompts 
        onPromptClick={setMessage}
        disabled={disabled || isProcessing}
      />
    </div>
  )
}
