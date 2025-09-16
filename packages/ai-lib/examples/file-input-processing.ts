/**
 * Example: File Input Processing with AI Agent
 * 
 * This example demonstrates how to:
 * 1. Process various file types (text, JSON, CSV, images)
 * 2. Analyze file contents with AI
 * 3. Compare multiple files
 * 4. Extract specific information from documents
 * 
 * Prerequisites:
 * - Set up your preferred AI provider (OpenAI, Bedrock, etc.)
 * - Have some sample files to process
 */

import { Agent, openAIModels, createFileInput, createFileInputFromBuffer } from '../src/index.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

// Create sample files for demonstration
function createSampleFiles() {
  const samplesDir = join(process.cwd(), 'sample-files')
  
  try {
    mkdirSync(samplesDir, { recursive: true })
  } catch {
    // Directory already exists
  }
  
  // Sample text file
  const textContent = `# Project Report

## Overview
This project aims to develop an AI-powered document analysis system.

## Key Features
- Multi-format file support
- Real-time processing
- Intelligent content extraction
- Comparative analysis

## Metrics
- Processing speed: 95% faster than manual review
- Accuracy: 98.5%
- Supported formats: 10+

## Conclusion
The system successfully meets all requirements and is ready for deployment.`

  writeFileSync(join(samplesDir, 'project-report.md'), textContent)

  // Sample CSV file
  const csvContent = `Name,Age,Department,Salary
John Doe,30,Engineering,75000
Jane Smith,28,Marketing,65000
Bob Johnson,35,Sales,70000
Alice Brown,32,Engineering,80000
Charlie Davis,29,Marketing,62000`

  writeFileSync(join(samplesDir, 'employees.csv'), csvContent)

  // Sample JSON file
  const jsonContent = JSON.stringify({
    project: 'AI Document Analyzer',
    version: '2.1.0',
    features: [
      { name: 'File Processing', status: 'complete', priority: 'high' },
      { name: 'AI Analysis', status: 'in-progress', priority: 'high' },
      { name: 'Web Interface', status: 'planned', priority: 'medium' }
    ],
    metrics: {
      filesProcessed: 1247,
      averageProcessingTime: '2.3s',
      accuracy: 0.985
    }
  }, null, 2)

  writeFileSync(join(samplesDir, 'project-data.json'), jsonContent)

  console.log(`📁 Sample files created in: ${samplesDir}`)
  return samplesDir
}

async function demonstrateTextFileProcessing() {
  console.log('\n📄 Text File Processing Example')
  console.log('==============================')

  try {
    const agent = new Agent({
      name: 'Document Analyst',
      systemPrompt: 'You are an expert document analyst specializing in extracting insights from various file formats.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.3
    })

    const samplesDir = createSampleFiles()
    
    // Process the markdown report
    const reportFile = createFileInput(join(samplesDir, 'project-report.md'))
    
    const result = await agent.processFile(
      reportFile,
      'Analyze this project report and provide key insights, potential risks, and recommendations.'
    )

    console.log('📊 Analysis Result:')
    console.log(result.content)
    console.log('\n📁 File Context:')
    console.log(`- Files processed: ${result.fileContext.files.length}`)
    console.log(`- Total size: ${result.fileContext.files[0].metadata.size} bytes`)
    
    if (result.usage) {
      console.log(`- Token usage: ${result.usage.inputTokens} input, ${result.usage.outputTokens} output`)
    }

  } catch (error) {
    console.error('❌ Error in text file processing:', error)
  }
}

async function demonstrateCSVAnalysis() {
  console.log('\n📊 CSV File Analysis Example')
  console.log('============================')

  try {
    const agent = new Agent({
      name: 'Data Analyst',
      systemPrompt: 'You are a data analyst expert at interpreting structured data and providing business insights.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.2
    })

    const samplesDir = createSampleFiles()
    
    // Process the CSV file
    const csvFile = createFileInput(join(samplesDir, 'employees.csv'), {
      textExtraction: {
        extractTables: true,
        extractMetadata: true
      }
    })

    const result = await agent.analyzeFiles([csvFile], 'detailed')

    console.log('📈 CSV Analysis:')
    console.log(result.content)
    
    // Show structured data that was extracted
    const processedFile = result.fileContext.files[0]
    if (processedFile.structuredData) {
      console.log('\n📋 Extracted Data Structure:')
      console.log(`- Headers: ${processedFile.structuredData.headers?.join(', ')}`)
      console.log(`- Row count: ${processedFile.structuredData.rowCount}`)
    }

  } catch (error) {
    console.error('❌ Error in CSV analysis:', error)
  }
}

async function demonstrateMultiFileComparison() {
  console.log('\n🔍 Multi-File Comparison Example')
  console.log('================================')

  try {
    const agent = new Agent({
      name: 'Comparative Analyst',
      systemPrompt: 'You excel at comparing and contrasting information across multiple documents to identify patterns, discrepancies, and insights.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.1
    })

    const samplesDir = createSampleFiles()
    
    // Process multiple files
    const files = [
      createFileInput(join(samplesDir, 'project-report.md'), {
        description: 'Project overview and summary report'
      }),
      createFileInput(join(samplesDir, 'project-data.json'), {
        description: 'Technical project data and metrics'
      }),
      createFileInput(join(samplesDir, 'employees.csv'), {
        description: 'Team member information and salaries'
      })
    ]

    const result = await agent.analyzeFiles(files, 'compare')

    console.log('🔄 Comparative Analysis:')
    console.log(result.content)
    
    console.log('\n📊 Processing Summary:')
    result.fileContext.files.forEach((file, index) => {
      console.log(`${index + 1}. ${file.metadata.filename}:`)
      console.log(`   - Type: ${file.metadata.mimeType}`)
      console.log(`   - Size: ${file.metadata.size} bytes`)
      console.log(`   - Processing time: ${file.metadata.processingTime}ms`)
      if (file.warnings && file.warnings.length > 0) {
        console.log(`   - Warnings: ${file.warnings.join(', ')}`)
      }
    })

  } catch (error) {
    console.error('❌ Error in multi-file comparison:', error)
  }
}

async function demonstrateStreamingFileProcessing() {
  console.log('\n🌊 Streaming File Processing Example')
  console.log('====================================')

  try {
    const agent = new Agent({
      name: 'Streaming Analyst',
      systemPrompt: 'You provide real-time analysis of documents with detailed explanations.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.4
    })

    const samplesDir = createSampleFiles()
    
    // Create a larger file for streaming demonstration
    const largeContent = `# Comprehensive Business Analysis

${Array.from({ length: 20 }, (_, i) => `
## Section ${i + 1}
This section contains detailed analysis of business metrics, market trends, and strategic recommendations. 
The data shows significant growth in key performance indicators with substantial opportunities for expansion.
Revenue has increased by ${15 + Math.floor(Math.random() * 20)}% compared to the previous quarter.
`).join('')}

## Conclusion
The analysis reveals strong performance across all metrics with clear indicators for continued growth.`

    writeFileSync(join(samplesDir, 'large-analysis.md'), largeContent)
    
    const largeFile = createFileInput(join(samplesDir, 'large-analysis.md'))
    
    console.log('🔄 Starting streaming analysis...')
    
    const generator = agent.processFilesStream(
      [largeFile],
      'Provide a comprehensive executive summary focusing on key trends and actionable recommendations.'
    )

    let content = ''
    for await (const chunk of generator) {
      if (typeof chunk === 'string') {
        process.stdout.write(chunk)
        content += chunk
      } else {
        // Final result
        console.log('\n\n📊 Final Analysis Complete:')
        console.log(`- Content length: ${content.length} characters`)
        console.log(`- File processed: ${chunk.fileContext.files[0].metadata.filename}`)
        if (chunk.usage) {
          console.log(`- Token usage: ${chunk.usage.inputTokens} input, ${chunk.usage.outputTokens} output`)
        }
      }
    }

  } catch (error) {
    console.error('❌ Error in streaming file processing:', error)
  }
}

async function demonstrateBufferFileProcessing() {
  console.log('\n💾 Buffer File Processing Example')
  console.log('=================================')

  try {
    const agent = new Agent({
      name: 'Buffer Processor',
      systemPrompt: 'You analyze content provided as raw data buffers.',
      model: openAIModels.gpt4oMini(),
      temperature: 0.3
    })

    // Create content in memory
    const memoryContent = `API Documentation

Endpoint: /api/users
Method: GET
Description: Retrieve user information
Parameters:
- id (required): User identifier
- include_profile (optional): Include profile data

Response:
{
  "user": {
    "id": 123,
    "name": "John Doe",
    "email": "john@example.com"
  }
}`

    const buffer = Buffer.from(memoryContent, 'utf-8')
    
    // Create file input from buffer
    const bufferFile = createFileInputFromBuffer(
      buffer,
      'text/plain',
      'api-docs.txt',
      {
        textExtraction: {
          extractMetadata: true
        }
      }
    )

    const result = await agent.processFile(
      bufferFile,
      'Analyze this API documentation and suggest improvements for clarity and completeness.'
    )

    console.log('📄 Buffer Analysis:')
    console.log(result.content)
    
    console.log(`\n📊 Processed buffer of ${buffer.length} bytes`)

  } catch (error) {
    console.error('❌ Error in buffer file processing:', error)
  }
}

async function runFileProcessingExamples() {
  console.log('🚀 File Input Processing Examples')
  console.log('==================================')

  try {
    await demonstrateTextFileProcessing()
    await demonstrateCSVAnalysis()
    await demonstrateMultiFileComparison()
    await demonstrateStreamingFileProcessing()
    await demonstrateBufferFileProcessing()

    console.log('\n🎉 All file processing examples completed!')
    console.log('\n💡 Key Features Demonstrated:')
    console.log('   ✅ Text file processing (Markdown)')
    console.log('   ✅ Structured data analysis (CSV, JSON)')
    console.log('   ✅ Multi-file comparison')
    console.log('   ✅ Streaming file processing')
    console.log('   ✅ Buffer-based file input')
    console.log('   ✅ File metadata extraction')
    console.log('   ✅ Error handling and warnings')

  } catch (error) {
    console.error('❌ Error:', error)
    
    if (error instanceof Error && error.message.includes('model')) {
      console.log('\n💡 To run this example:')
      console.log('   1. Set up your API key (OpenAI, Bedrock, etc.)')
      console.log('   2. Configure your preferred model')
      console.log('   3. Ensure you have the required dependencies')
    }
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  runFileProcessingExamples()
}

export { 
  runFileProcessingExamples,
  demonstrateTextFileProcessing,
  demonstrateCSVAnalysis,
  demonstrateMultiFileComparison,
  demonstrateStreamingFileProcessing,
  demonstrateBufferFileProcessing
}
