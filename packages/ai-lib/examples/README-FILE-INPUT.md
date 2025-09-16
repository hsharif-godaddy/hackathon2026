# File Input Processing

This directory contains examples for using file input processing with the AI Library, enabling AI agents to analyze and process various file types.

## Overview

The file input processing feature allows AI agents to:
- Read and process multiple file types (text, images, PDFs, Office documents)
- Extract structured data from CSV and JSON files
- Perform intelligent analysis and comparison across multiple files
- Stream responses while processing large files
- Handle both file paths and buffer inputs

## Supported File Types

### Text Files
- **Plain Text** (`.txt`)
- **Markdown** (`.md`)
- **CSV** (`.csv`) - with structured data extraction
- **JSON** (`.json`) - with object parsing

### Image Files
- **JPEG** (`.jpg`, `.jpeg`)
- **PNG** (`.png`)
- **GIF** (`.gif`)
- **WebP** (`.webp`)
- **SVG** (`.svg`)

### Document Files (Placeholder Support)
- **PDF** (`.pdf`) - requires `pdf-parse` library
- **Word** (`.docx`) - requires `mammoth` library
- **Excel** (`.xlsx`) - requires `xlsx` library
- **PowerPoint** (`.pptx`) - requires appropriate parsing library

## Basic Usage

### Simple File Processing

```typescript
import { Agent, openAIModels, createFileInput } from '@airo/ai-lib'

const agent = new Agent({
  name: 'Document Analyst',
  systemPrompt: 'You are an expert document analyst.',
  model: openAIModels.gpt4oMini(),
  temperature: 0.3
})

// Process a single file
const file = createFileInput('path/to/document.md')
const result = await agent.processFile(
  file,
  'Analyze this document and provide key insights.'
)

console.log(result.content)
console.log(`Processed ${result.fileContext.files.length} files`)
```

### Multiple File Processing

```typescript
// Process multiple files
const files = [
  createFileInput('report.md', {
    description: 'Monthly business report'
  }),
  createFileInput('data.csv', {
    textExtraction: { extractTables: true }
  }),
  createFileInput('config.json')
]

const result = await agent.processFiles(
  files,
  'Compare these files and identify key relationships.'
)
```

### Buffer-Based Processing

```typescript
import { createFileInputFromBuffer } from '@airo/ai-lib'

const content = 'Your file content here...'
const buffer = Buffer.from(content, 'utf-8')

const fileInput = createFileInputFromBuffer(
  buffer,
  'text/plain',
  'data.txt'
)

const result = await agent.processFile(
  fileInput,
  'Analyze this content.'
)
```

### Streaming File Processing

```typescript
// Stream responses for large files
const generator = agent.processFilesStream(
  [largeFile],
  'Provide a comprehensive analysis.'
)

for await (const chunk of generator) {
  if (typeof chunk === 'string') {
    process.stdout.write(chunk) // Real-time output
  } else {
    // Final result with file context
    console.log('Analysis complete!')
    console.log(chunk.fileContext.summary)
  }
}
```

## Analysis Types

The `analyzeFiles` method provides pre-built analysis templates:

```typescript
// Quick summary
const summary = await agent.analyzeFiles(files, 'summary')

// Detailed analysis
const detailed = await agent.analyzeFiles(files, 'detailed')

// Extract key information
const extracted = await agent.analyzeFiles(files, 'extract')

// Compare multiple files
const comparison = await agent.analyzeFiles(files, 'compare')
```

## File Processing Options

### Text Extraction Options

```typescript
const fileInput = createFileInput('document.pdf', {
  textExtraction: {
    includeFormatting: true,    // Preserve formatting
    extractTables: true,        // Extract table data
    extractMetadata: true       // Include document metadata
  }
})
```

### Image Processing Options

```typescript
const imageInput = createFileInput('image.jpg', {
  imageProcessing: {
    maxDimensions: { width: 1024, height: 1024 },
    quality: 85,
    convertTo: 'jpeg'
  }
})
```

### Size Limits

```typescript
const fileInput = createFileInput('large-file.txt', {
  maxSize: 50 * 1024 * 1024 // 50MB limit
})
```

## File Context and Metadata

Each processed file includes rich metadata:

```typescript
const result = await agent.processFile(file, 'Analyze this.')

result.fileContext.files.forEach(file => {
  console.log(`File: ${file.metadata.filename}`)
  console.log(`Size: ${file.metadata.size} bytes`)
  console.log(`Type: ${file.metadata.mimeType}`)
  console.log(`Processing time: ${file.metadata.processingTime}ms`)
  
  if (file.warnings?.length > 0) {
    console.log(`Warnings: ${file.warnings.join(', ')}`)
  }
})
```

## Error Handling

The file processor includes comprehensive error handling:

```typescript
try {
  const result = await agent.processFiles(files, 'Analyze these files.')
  
  // Check for processing warnings
  result.fileContext.files.forEach(file => {
    if (file.warnings?.length > 0) {
      console.log(`Warnings for ${file.metadata.filename}:`)
      file.warnings.forEach(warning => console.log(`  - ${warning}`))
    }
  })
} catch (error) {
  console.error('File processing failed:', error)
}
```

## Advanced Features

### Custom Message Building

The system uses message builders that can be customized for file processing:

```typescript
import { SimpleMessageBuilder } from '@airo/ai-lib'

const customBuilder = new SimpleMessageBuilder('Custom system prompt')

const agent = new Agent({
  name: 'Custom Agent',
  systemPrompt: 'Base prompt',
  model: openAIModels.gpt4oMini(),
  messageBuilder: customBuilder
})
```

### Structured Data Access

For CSV and JSON files, access the structured data directly:

```typescript
const result = await agent.processFile(csvFile, 'Analyze this data.')

const processedFile = result.fileContext.files[0]
if (processedFile.structuredData) {
  const { headers, rows, rowCount } = processedFile.structuredData
  console.log(`CSV has ${rowCount} rows with headers: ${headers.join(', ')}`)
}
```

### Image Data Handling

For image files, the base64 content is available:

```typescript
const result = await agent.processFile(imageFile, 'Describe this image.')

const processedFile = result.fileContext.files[0]
if (processedFile.base64Content) {
  console.log(`Image data: ${processedFile.base64Content.length} characters`)
  // Save or further process the image data
}
```

## Performance Considerations

### File Size Limits
- Default maximum file size: 10MB
- Configurable via `FileProcessingOptions.maxSize`
- Large files may impact processing time and token usage

### Memory Usage
- Files are loaded into memory for processing
- Consider streaming for very large files
- Buffer-based inputs are more memory efficient than file paths

### Token Usage
- File contents are included in the AI model prompt
- Large files will consume more input tokens
- Monitor usage through `result.usage` statistics

## Examples

Run the comprehensive example:

```bash
npm run example:file-processing
```

This example demonstrates:
- Text file analysis (Markdown)
- CSV data processing with structured extraction
- Multi-file comparison and relationships
- Streaming analysis for large files
- Buffer-based file processing
- Error handling and metadata extraction

## Dependencies

### Core Dependencies (Included)
- File system operations (Node.js `fs`)
- Path manipulation utilities
- MIME type detection

### Optional Dependencies (Install Separately)
```bash
# For PDF processing
npm install pdf-parse

# For Word document processing
npm install mammoth

# For Excel file processing
npm install xlsx

# For image processing
npm install sharp
```

## Best Practices

1. **File Validation**: Always validate file types and sizes before processing
2. **Error Handling**: Check for warnings and handle processing errors gracefully
3. **Memory Management**: Use streaming for large files to avoid memory issues
4. **Security**: Sanitize file inputs and validate file types for security
5. **Performance**: Monitor token usage and processing times for optimization

## Troubleshooting

### Common Issues

1. **Unsupported File Type**
   ```
   Error: Unsupported file type for: document.unknown
   ```
   **Solution**: Ensure the file extension is supported or manually specify the MIME type

2. **File Too Large**
   ```
   Error: File size exceeds maximum allowed size
   ```
   **Solution**: Increase `maxSize` option or process file in chunks

3. **Processing Warnings**
   ```
   Warning: PDF processing requires additional dependencies
   ```
   **Solution**: Install the required library (e.g., `pdf-parse`)

4. **Memory Issues**
   ```
   Error: JavaScript heap out of memory
   ```
   **Solution**: Use streaming processing or reduce file sizes

### Getting Help

- Check the file type is in the supported list
- Verify file permissions and accessibility
- Review processing options and limits
- Monitor token usage and costs
- Use streaming for large files

For additional support, refer to the main AI Library documentation or create an issue in the repository.
