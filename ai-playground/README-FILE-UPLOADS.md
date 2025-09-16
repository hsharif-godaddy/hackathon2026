# File Upload Support in AI Playground

The AI Playground now supports file uploads, allowing users to upload various file types and have them analyzed by AI agents in real-time.

## Features

### 📁 Supported File Types

- **Text Files**: `.txt`, `.md`, `.csv`, `.json`
- **Images**: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`
- **Documents**: `.pdf`, `.docx`, `.xlsx`, `.pptx` (with appropriate libraries)

### 🎯 Key Capabilities

- **Drag & Drop Interface**: Easy file upload with visual feedback
- **Multiple File Support**: Upload up to 5 files simultaneously
- **File Size Validation**: 10MB maximum per file
- **Real-time Processing**: Streaming AI analysis of uploaded files
- **File Display**: Visual representation of attached files in chat
- **Structured Data Extraction**: Automatic parsing of CSV and JSON files
- **Image Analysis**: Base64 encoding for image processing

## How It Works

### 1. **Upload Process**

```typescript
// User uploads files through the UI
// Files are sent to /api/upload endpoint
// Server validates and stores files
// WebSocket receives file references
// AI Agent processes files with content
```

### 2. **File Processing Pipeline**

```
Upload → Validation → Storage → WebSocket → Agent Processing → Streaming Response
```

### 3. **AI Integration**

The uploaded files are processed using the AI Library's file processing capabilities:

```typescript
// Convert uploaded files to FileInput format
const fileInputs = files.map(file => {
  const fileInput = createFileInput(file.filepath)
  fileInput.description = `User uploaded file: ${file.originalName}`
  return fileInput
})

// Use agent's file processing with streaming
const generator = agent.processFilesStream(fileInputs, message)
```

## Usage

### 1. **Upload Files**

1. Click the paperclip icon (📎) in the chat input area
2. Drag and drop files or click to browse
3. Files are automatically uploaded and validated
4. See upload progress and file information

### 2. **Send Message with Files**

1. Add files using the upload interface
2. Type your question or analysis request (optional)
3. Click send to process files with AI
4. Watch real-time streaming analysis

### 3. **File Display**

- **User Messages**: Show attached file badges with names and sizes
- **File Validation**: Real-time feedback on file type and size limits
- **Upload Progress**: Visual progress bars during upload
- **Error Handling**: Clear error messages for failed uploads

## Technical Implementation

### API Endpoints

#### POST `/api/upload`

Handles file uploads with validation and storage.

**Request**: `multipart/form-data` with file
**Response**: 
```json
{
  "success": true,
  "file": {
    "id": "timestamp",
    "originalName": "document.pdf",
    "filename": "123456_document.pdf",
    "filepath": "/uploads/123456_document.pdf",
    "size": 1024000,
    "mimeType": "application/pdf",
    "uploadedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### WebSocket Integration

Enhanced `chat_message` event now supports file attachments:

```typescript
socket.emit('chat_message', {
  message: "Please analyze these files",
  useAgentic: true,
  files: [
    {
      id: "123456",
      originalName: "data.csv",
      filename: "123456_data.csv", 
      filepath: "/uploads/123456_data.csv",
      size: 1024,
      mimeType: "text/csv",
      uploadedAt: "2024-01-01T00:00:00.000Z"
    }
  ]
})
```

### UI Components

#### `FileUpload` Component

- Drag & drop interface using `react-dropzone`
- Upload progress tracking
- File validation and error handling
- Maximum file limits and size restrictions

#### `EnhancedPromptInput` Component

- Integrated file upload toggle
- Attached file display with removal options
- Smart placeholder text based on attached files
- Combined text and file submission

### File Processing

Files are processed using the AI Library's comprehensive file processing system:

- **Text Extraction**: Content extraction from documents
- **Structured Data**: CSV/JSON parsing with table extraction
- **Image Processing**: Base64 encoding for AI analysis
- **Metadata Extraction**: File size, type, and processing time

## Configuration

### File Upload Limits

```typescript
// In /api/upload/route.ts
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_FILES = 5
const UPLOAD_DIR = join(process.cwd(), 'uploads')
```

### Supported File Types

```typescript
const ALLOWED_EXTENSIONS = [
  '.txt', '.md', '.csv', '.json', '.pdf',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
  '.docx', '.xlsx', '.pptx'
]
```

### WebSocket Configuration

```typescript
// Enhanced message type with file support
interface ChatMessageData {
  message: string
  useAgentic?: boolean
  files?: UploadedFile[]
}
```

## Security Considerations

### File Validation

1. **File Type Checking**: Whitelist of allowed extensions
2. **Size Limits**: 10MB maximum per file
3. **Filename Sanitization**: Remove special characters
4. **Upload Directory**: Isolated file storage location

### File Storage

- Files stored in local `uploads/` directory
- Timestamped filenames to prevent conflicts
- No direct web access to uploaded files
- Server-side validation and processing only

## Error Handling

### Upload Errors

- **Invalid File Type**: Clear message with supported types
- **File Too Large**: Size limit notification
- **Upload Failed**: Network or server error handling
- **Processing Errors**: Graceful fallback with error messages

### User Feedback

- **Progress Indicators**: Visual upload progress
- **Status Messages**: Real-time upload and processing status
- **Error Display**: User-friendly error messages
- **Success Confirmation**: Clear success indicators

## Performance

### Optimization

- **Streaming Processing**: Real-time file analysis without blocking
- **Progress Updates**: Simulated progress for better UX
- **Memory Management**: Efficient file handling and cleanup
- **Async Processing**: Non-blocking file upload and processing

### Scalability

- **File Size Limits**: Prevent memory issues
- **Concurrent Uploads**: Multiple file handling
- **Storage Management**: Local file system storage
- **Error Recovery**: Robust error handling and recovery

## Future Enhancements

### Planned Features

1. **Cloud Storage**: Integration with S3/GCS for scalable storage
2. **File Preview**: In-browser preview for supported file types
3. **Batch Processing**: Multiple file analysis optimization
4. **File History**: Uploaded file management and reuse
5. **Advanced Validation**: Content-based file validation
6. **Compression**: Automatic file compression for large uploads

### Integration Options

1. **Vector Storage**: File content vectorization for similarity search
2. **Database Storage**: File metadata and content indexing
3. **Cache Management**: Processed file result caching
4. **API Extensions**: RESTful API for file management
5. **Authentication**: User-based file access control

## Troubleshooting

### Common Issues

1. **Files Not Uploading**
   - Check file size (max 10MB)
   - Verify file type is supported
   - Ensure stable internet connection

2. **Processing Errors**
   - Check server logs for specific errors
   - Verify AI API keys are configured
   - Ensure file is not corrupted

3. **Display Issues**
   - Refresh the page if files don't appear
   - Check browser console for errors
   - Verify WebSocket connection

### Debug Information

Enable debug mode in development:
```bash
NODE_ENV=development pnpm run dev
```

This provides detailed logging for:
- File upload progress
- Processing steps
- Error details
- Performance metrics

The file upload feature transforms the AI Playground into a comprehensive document analysis tool, enabling users to upload and analyze various file types with real-time AI processing and streaming responses.
