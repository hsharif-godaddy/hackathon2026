'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { SendIcon, Loader2Icon, PaperclipIcon, X, FileIcon } from 'lucide-react'
import { ExamplePrompts } from './ExamplePrompts'
import FileUpload, { type UploadedFile } from './FileUpload'

interface EnhancedPromptInputProps {
  onSubmit: (message: string, files?: UploadedFile[]) => void
  disabled?: boolean
  status: 'idle' | 'thinking' | 'processing' | 'complete' | 'error'
  className?: string
}

export function EnhancedPromptInput({ 
  onSubmit, 
  disabled = false, 
  status,
  className 
}: EnhancedPromptInputProps) {
  const [message, setMessage] = useState('')
  const [showFileUpload, setShowFileUpload] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if ((message.trim() || attachedFiles.length > 0) && !disabled && status !== 'thinking' && status !== 'processing') {
      console.log('📤 EnhancedPromptInput submitting:', {
        message: message.trim() || 'Please analyze the uploaded files.',
        fileCount: attachedFiles.length,
        files: attachedFiles.map(f => ({ name: f.originalName, size: f.size, id: f.id }))
      })
      
      onSubmit(message.trim() || 'Please analyze the uploaded files.', attachedFiles)
      setMessage('')
      setAttachedFiles([])
      setShowFileUpload(false)
    }
  }

  const handleFilesUploaded = (files: UploadedFile[]) => {
    setAttachedFiles(files)
  }

  const removeFile = (fileId: string) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const isProcessing = status === 'thinking' || status === 'processing'

  return (
    <div className={cn("space-y-3", className)}>
      {/* File Upload Section */}
      {showFileUpload && (
        <Card className="p-4">
          <FileUpload 
            onFilesUploaded={handleFilesUploaded}
            maxFiles={5}
            disabled={disabled || isProcessing}
          />
        </Card>
      )}

      {/* Attached Files Display */}
      {attachedFiles.length > 0 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <FileIcon className="h-4 w-4" />
            <span className="text-sm font-medium">
              {attachedFiles.length} file{attachedFiles.length > 1 ? 's' : ''} attached
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachedFiles.map((file) => (
              <Badge
                key={file.id}
                variant="secondary"
                className="flex items-center gap-1 max-w-[200px]"
              >
                <span className="truncate">
                  {file.originalName}
                </span>
                <span className="text-xs opacity-70">
                  ({formatFileSize(file.size)})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFile(file.id)}
                  className="h-4 w-4 p-0 hover:bg-destructive/20"
                >
                  <X className="h-2 w-2" />
                </Button>
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              attachedFiles.length > 0 
                ? "Describe what you'd like me to do with the uploaded files..." 
                : "Ask me to solve a complex problem or upload files to analyze..."
            }
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

        <div className="flex flex-col gap-2">
          {/* File Upload Toggle */}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowFileUpload(!showFileUpload)}
            disabled={disabled || isProcessing}
            className={cn(
              "h-[30px] w-12",
              showFileUpload && "bg-primary/10 border-primary"
            )}
          >
            <PaperclipIcon className="h-4 w-4" />
          </Button>

          {/* Send Button */}
          <Button
            type="submit"
            disabled={(!message.trim() && attachedFiles.length === 0) || disabled || isProcessing}
            size="icon"
            className="h-[30px] w-12"
          >
            {isProcessing ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>

      {/* Example Prompts */}
      {!showFileUpload && attachedFiles.length === 0 && (
        <ExamplePrompts 
          onPromptClick={setMessage}
          disabled={disabled || isProcessing}
        />
      )}
    </div>
  )
}

export default EnhancedPromptInput
