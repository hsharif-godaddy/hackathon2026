import React, { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { AlertCircle, CheckCircle, FileIcon, UploadIcon, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface UploadedFile {
  id: string
  originalName: string
  filename: string
  filepath: string
  size: number
  mimeType: string | null
  uploadedAt: string
}

interface FileUploadProps {
  onFilesUploaded: (files: UploadedFile[]) => void
  maxFiles?: number
  disabled?: boolean
  className?: string
}

interface FileState {
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  uploadedFile?: UploadedFile
}

export function FileUpload({ 
  onFilesUploaded, 
  maxFiles = 5, 
  disabled = false,
  className 
}: FileUploadProps) {
  const [files, setFiles] = useState<FileState[]>([])

  const uploadFile = async (file: File): Promise<UploadedFile> => {
    const formData = new FormData()
    formData.append('file', file)

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Upload failed')
    }

    const result = await response.json()
    return result.file
  }

  const handleUpload = async (file: File) => {
    const fileId = Date.now().toString() + Math.random().toString()
    
    // Add file to state
    setFiles(prev => [...prev, {
      file,
      status: 'uploading',
      progress: 0
    }])

    try {
      // Simulate progress updates
      const updateProgress = (progress: number) => {
        setFiles(prev => prev.map(f => 
          f.file === file ? { ...f, progress } : f
        ))
      }

      // Update progress
      updateProgress(25)
      await new Promise(resolve => setTimeout(resolve, 200))
      updateProgress(50)
      await new Promise(resolve => setTimeout(resolve, 200))
      updateProgress(75)

      const uploadedFile = await uploadFile(file)
      
      updateProgress(100)
      
      // Mark as success
      setFiles(prev => prev.map(f => 
        f.file === file ? { 
          ...f, 
          status: 'success' as const, 
          progress: 100,
          uploadedFile 
        } : f
      ))

      // Notify parent of successful uploads
      const successfulFiles = files
        .filter(f => f.status === 'success' && f.uploadedFile)
        .map(f => f.uploadedFile!)
      
      onFilesUploaded([...successfulFiles, uploadedFile])

    } catch (error) {
      setFiles(prev => prev.map(f => 
        f.file === file ? { 
          ...f, 
          status: 'error' as const,
          error: error instanceof Error ? error.message : 'Upload failed'
        } : f
      ))
    }
  }

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (disabled) return
    
    const remainingSlots = maxFiles - files.length
    const filesToUpload = acceptedFiles.slice(0, remainingSlots)
    
    filesToUpload.forEach(handleUpload)
  }, [files.length, maxFiles, disabled])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    maxFiles: maxFiles - files.length,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'application/pdf': ['.pdf'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/gif': ['.gif'],
      'image/webp': ['.webp'],
      'image/svg+xml': ['.svg'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
    }
  })

  const removeFile = (fileToRemove: File) => {
    setFiles(prev => prev.filter(f => f.file !== fileToRemove))
    
    // Update successful files list
    const successfulFiles = files
      .filter(f => f.file !== fileToRemove && f.status === 'success' && f.uploadedFile)
      .map(f => f.uploadedFile!)
    
    onFilesUploaded(successfulFiles)
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Dropzone */}
      <Card
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
          isDragActive && 'border-primary bg-primary/5',
          disabled && 'opacity-50 cursor-not-allowed',
          files.length >= maxFiles && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2">
          <UploadIcon className="h-8 w-8 text-muted-foreground" />
          <div className="text-sm">
            {isDragActive ? (
              <p>Drop files here...</p>
            ) : (
              <div>
                <p className="font-medium">
                  Click to upload or drag and drop
                </p>
                <p className="text-muted-foreground">
                  Supports: Text, Images, PDF, Office docs (max 10MB, {maxFiles} files)
                </p>
              </div>
            )}
          </div>
          {files.length >= maxFiles && (
            <Badge variant="secondary">
              Maximum {maxFiles} files reached
            </Badge>
          )}
        </div>
      </Card>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Uploaded Files</h4>
          {files.map((fileState, index) => (
            <Card key={index} className="p-3">
              <div className="flex items-center gap-3">
                <FileIcon className="h-4 w-4 text-muted-foreground" />
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {fileState.file.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(fileState.file.size)}
                    </span>
                  </div>
                  
                  {fileState.status === 'uploading' && (
                    <div className="mt-1">
                      <Progress value={fileState.progress} className="h-1" />
                      <span className="text-xs text-muted-foreground">
                        Uploading... {fileState.progress}%
                      </span>
                    </div>
                  )}
                  
                  {fileState.status === 'error' && (
                    <div className="flex items-center gap-1 mt-1">
                      <AlertCircle className="h-3 w-3 text-destructive" />
                      <span className="text-xs text-destructive">
                        {fileState.error}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {fileState.status === 'success' && (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  )}
                  {fileState.status === 'error' && (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(fileState.file)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export default FileUpload
