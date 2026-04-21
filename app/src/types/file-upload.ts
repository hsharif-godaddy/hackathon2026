export interface UploadedFileMetadata {
  id: string
  originalName: string
  filename: string
  size: number
  mimeType: string | null
  uploadedAt: string
}

export interface UploadResult {
  uploadId: string
  appId: string
  files: UploadedFileMetadata[]
  expiresAt?: string
}

export interface UploadProgress {
  fileId: string
  filename: string
  loaded: number
  total: number
  percentage: number
}

export interface PendingUpload {
  file: File
  preview?: string
  id: string
}

export interface UploadError {
  file: string
  error: string
}
