/**
 * Agentic Bedrock File Upload and Analysis Example
 * 
 * This example demonstrates:
 * - File upload and processing with ExperimentalAgentFactory
 * - Multi-format file analysis (text, JSON, CSV, images)
 * - Agentic behavior with file content tools
 * - Document comparison and extraction
 * - Intelligent file content understanding
 */

import 'dotenv/config'
import { getModel } from '../src/providers/unified-provider.js'
import { createTool } from '../src/tools/base-tool.js'
import { createExperimentalAgentFactory } from '../src/core/agent-factory-experimental.js'
import { z } from 'zod'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

// File content extraction tool
const fileExtractionTool = createTool(
  'Extract and analyze content from uploaded files',
  z.object({
    filePath: z.string().describe('Path to the file to analyze'),
    analysisType: z.string().describe('Type of analysis: summary, detailed, extract-data, compare'),
    extractionFocus: z.string().describe('What to focus on extracting: key-points, data, metrics, etc.').optional()
  }),
  async ({ filePath, analysisType, extractionFocus = 'general' }) => {
    console.log(`📄 [File Extraction Tool] Analyzing ${filePath} (${analysisType}, focus: ${extractionFocus})`)
    
    try {
      // Read file content
      const content = readFileSync(filePath, 'utf-8')
      const fileStats = {
        size: content.length,
        lines: content.split('\n').length,
        words: content.split(/\s+/).filter(word => word.length > 0).length
      }
      
      // Basic content analysis
      let analysis = {}
      
      if (analysisType === 'summary') {
        analysis = {
          type: 'summary',
          overview: content.substring(0, 500) + (content.length > 500 ? '...' : ''),
          keyTopics: extractKeyTopics(content),
          structure: analyzeStructure(content)
        }
      } else if (analysisType === 'extract-data') {
        analysis = {
          type: 'data-extraction',
          numbers: extractNumbers(content),
          dates: extractDates(content),
          emails: extractEmails(content),
          urls: extractUrls(content)
        }
      } else if (analysisType === 'detailed') {
        analysis = {
          type: 'detailed',
          sections: identifySections(content),
          sentiment: analyzeSentiment(content),
          complexity: analyzeComplexity(content),
          recommendations: generateRecommendations(content)
        }
      }
      
      const result = {
        filePath,
        fileStats,
        analysis,
        extractionFocus,
        processedAt: new Date().toISOString()
      }
      
      console.log(`✅ [File Extraction Tool] Processed ${filePath}: ${fileStats.words} words, ${fileStats.lines} lines`)
      return result
      
    } catch (error) {
      console.log(`❌ [File Extraction Tool] Error processing ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      return {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        processedAt: new Date().toISOString()
      }
    }
  }
)

// Document comparison tool
const documentComparisonTool = createTool(
  'Compare multiple documents and find similarities/differences',
  z.object({
    filePaths: z.array(z.string()).describe('Array of file paths to compare'),
    comparisonType: z.string().describe('Type of comparison: content, structure, metrics, sentiment')
  }),
  async ({ filePaths, comparisonType }) => {
    console.log(`🔍 [Document Comparison Tool] Comparing ${filePaths.length} documents (${comparisonType})`)
    
    const documents = []
    
    for (const filePath of filePaths) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        documents.push({
          filePath,
          content,
          stats: {
            size: content.length,
            lines: content.split('\n').length,
            words: content.split(/\s+/).filter(word => word.length > 0).length
          }
        })
      } catch (error) {
        console.log(`❌ Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    
    let comparison = {}
    
    if (comparisonType === 'content') {
      comparison = {
        type: 'content',
        similarities: findContentSimilarities(documents),
        differences: findContentDifferences(documents),
        commonThemes: findCommonThemes(documents)
      }
    } else if (comparisonType === 'structure') {
      comparison = {
        type: 'structure',
        formats: documents.map(doc => detectFormat(doc.content)),
        sections: documents.map(doc => identifySections(doc.content)),
        organization: compareOrganization(documents)
      }
    } else if (comparisonType === 'metrics') {
      comparison = {
        type: 'metrics',
        statistics: documents.map(doc => doc.stats),
        averages: calculateAverages(documents),
        outliers: findOutliers(documents)
      }
    }
    
    const result = {
      documentsCompared: filePaths,
      comparisonType,
      comparison,
      summary: generateComparisonSummary(documents, comparison),
      comparedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Document Comparison Tool] Compared ${documents.length} documents`)
    return result
  }
)

// Content search tool
const contentSearchTool = createTool(
  'Search for specific content patterns across uploaded files',
  z.object({
    searchQuery: z.string().describe('What to search for (text, patterns, concepts)'),
    filePaths: z.array(z.string()).describe('Files to search in'),
    searchType: z.string().describe('Type of search: exact, semantic, pattern, keyword')
  }),
  async ({ searchQuery, filePaths, searchType }) => {
    console.log(`🔎 [Content Search Tool] Searching for "${searchQuery}" in ${filePaths.length} files (${searchType})`)
    
    const searchResults = []
    
    for (const filePath of filePaths) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const matches = []
        
        if (searchType === 'exact') {
          const lines = content.split('\n')
          lines.forEach((line, index) => {
            if (line.toLowerCase().includes(searchQuery.toLowerCase())) {
              matches.push({
                line: index + 1,
                content: line.trim(),
                context: getLineContext(lines, index)
              })
            }
          })
        } else if (searchType === 'pattern') {
          // Basic pattern matching
          const regex = new RegExp(searchQuery, 'gi')
          const matches_array = content.match(regex) || []
          matches.push(...matches_array.map(match => ({ match, type: 'pattern' })))
        } else if (searchType === 'keyword') {
          const keywords = searchQuery.split(/\s+/)
          const lines = content.split('\n')
          lines.forEach((line, index) => {
            const foundKeywords = keywords.filter(keyword => 
              line.toLowerCase().includes(keyword.toLowerCase())
            )
            if (foundKeywords.length > 0) {
              matches.push({
                line: index + 1,
                content: line.trim(),
                keywords: foundKeywords
              })
            }
          })
        }
        
        searchResults.push({
          filePath,
          matches: matches.slice(0, 10), // Limit to first 10 matches
          totalMatches: matches.length
        })
        
      } catch (error) {
        searchResults.push({
          filePath,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
    
    const result = {
      searchQuery,
      searchType,
      searchResults,
      totalFilesSearched: filePaths.length,
      totalMatches: searchResults.reduce((sum, r) => sum + (r.totalMatches || 0), 0),
      searchedAt: new Date().toISOString()
    }
    
    console.log(`✅ [Content Search Tool] Found ${result.totalMatches} total matches`)
    return result
  }
)

// Helper functions for file analysis
function extractKeyTopics(content: string): string[] {
  const words = content.toLowerCase().split(/\s+/)
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did'])
  
  const wordCounts: Record<string, number> = {}
  words.forEach(word => {
    const cleanWord = word.replace(/[^\w]/g, '')
    if (cleanWord.length > 3 && !commonWords.has(cleanWord)) {
      wordCounts[cleanWord] = (wordCounts[cleanWord] || 0) + 1
    }
  })
  
  return Object.entries(wordCounts)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([word]) => word)
}

function analyzeStructure(content: string): any {
  const lines = content.split('\n')
  return {
    hasHeaders: lines.some(line => line.startsWith('#')),
    hasBulletPoints: lines.some(line => line.trim().startsWith('-') || line.trim().startsWith('*')),
    hasNumberedLists: lines.some(line => /^\s*\d+\./.test(line)),
    paragraphs: content.split('\n\n').length,
    codeBlocks: (content.match(/```/g) || []).length / 2
  }
}

function extractNumbers(content: string): string[] {
  const numbers = content.match(/\b\d+(?:\.\d+)?%?\b/g) || []
  return numbers.slice(0, 10)
}

function extractDates(content: string): string[] {
  const dates = content.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) || []
  return dates.slice(0, 5)
}

function extractEmails(content: string): string[] {
  const emails = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || []
  return emails.slice(0, 5)
}

function extractUrls(content: string): string[] {
  const urls = content.match(/https?:\/\/[^\s]+/g) || []
  return urls.slice(0, 5)
}

function identifySections(content: string): string[] {
  const sections = []
  const lines = content.split('\n')
  
  for (const line of lines) {
    if (line.startsWith('#')) {
      sections.push(line.replace(/^#+\s*/, ''))
    }
  }
  
  return sections.slice(0, 10)
}

function analyzeSentiment(content: string): string {
  const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'success', 'achieve', 'positive']
  const negativeWords = ['bad', 'terrible', 'awful', 'failure', 'problem', 'issue', 'negative', 'difficult']
  
  const words = content.toLowerCase().split(/\s+/)
  const positive = words.filter(word => positiveWords.some(pw => word.includes(pw))).length
  const negative = words.filter(word => negativeWords.some(nw => word.includes(nw))).length
  
  if (positive > negative) return 'positive'
  if (negative > positive) return 'negative'
  return 'neutral'
}

function analyzeComplexity(content: string): any {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const avgSentenceLength = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
  
  return {
    avgSentenceLength: Math.round(avgSentenceLength),
    complexity: avgSentenceLength > 20 ? 'high' : avgSentenceLength > 15 ? 'medium' : 'low',
    readabilityScore: Math.max(100 - avgSentenceLength * 2, 0)
  }
}

function generateRecommendations(content: string): string[] {
  const recommendations = []
  
  if (content.length < 500) {
    recommendations.push('Consider expanding the content with more details')
  }
  
  if (!content.includes('\n\n')) {
    recommendations.push('Add paragraph breaks for better readability')
  }
  
  if (content.split('\n').filter(line => line.startsWith('#')).length === 0) {
    recommendations.push('Add section headers to improve structure')
  }
  
  return recommendations
}

// Document comparison helper functions
function findContentSimilarities(documents: any[]): string[] {
  // Simple word overlap analysis
  const wordSets = documents.map(doc => 
    new Set(doc.content.toLowerCase().split(/\s+/).filter(word => word.length > 3))
  )
  
  if (wordSets.length < 2) return []
  
  const commonWords = [...wordSets[0]].filter(word => 
    wordSets.slice(1).every(set => set.has(word))
  )
  
  return commonWords.slice(0, 10)
}

function findContentDifferences(documents: any[]): any[] {
  return documents.map((doc, index) => ({
    document: index + 1,
    uniqueAspects: `Document ${index + 1} has unique characteristics`,
    length: doc.content.length
  }))
}

function findCommonThemes(documents: any[]): string[] {
  const allTopics = documents.flatMap(doc => extractKeyTopics(doc.content))
  const topicCounts: Record<string, number> = {}
  
  allTopics.forEach(topic => {
    topicCounts[topic] = (topicCounts[topic] || 0) + 1
  })
  
  return Object.entries(topicCounts)
    .filter(([, count]) => count > 1)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5)
    .map(([topic]) => topic)
}

function detectFormat(content: string): string {
  if (content.includes('```')) return 'markdown'
  if (content.startsWith('{') || content.startsWith('[')) return 'json'
  if (content.includes(',') && content.split('\n').length > 2) return 'csv'
  return 'text'
}

function compareOrganization(documents: any[]): string {
  const structures = documents.map(doc => analyzeStructure(doc.content))
  const hasConsistentStructure = structures.every(s => s.hasHeaders === structures[0].hasHeaders)
  return hasConsistentStructure ? 'consistent' : 'varied'
}

function calculateAverages(documents: any[]): any {
  const totalWords = documents.reduce((sum, doc) => sum + doc.stats.words, 0)
  const totalLines = documents.reduce((sum, doc) => sum + doc.stats.lines, 0)
  
  return {
    avgWords: Math.round(totalWords / documents.length),
    avgLines: Math.round(totalLines / documents.length),
    avgSize: Math.round(documents.reduce((sum, doc) => sum + doc.stats.size, 0) / documents.length)
  }
}

function findOutliers(documents: any[]): any[] {
  const averages = calculateAverages(documents)
  return documents.filter(doc => 
    doc.stats.words > averages.avgWords * 2 || doc.stats.words < averages.avgWords * 0.5
  ).map(doc => ({ filePath: doc.filePath, reason: 'Unusual length' }))
}

function generateComparisonSummary(documents: any[], comparison: any): string {
  return `Compared ${documents.length} documents. Analysis type: ${comparison.type}. Documents show ${comparison.type === 'structure' ? comparison.organization : 'varied'} characteristics.`
}

function getLineContext(lines: string[], index: number): string[] {
  const start = Math.max(0, index - 1)
  const end = Math.min(lines.length, index + 2)
  return lines.slice(start, end)
}

// Create sample files for demonstration
function createSampleFiles(): string[] {
  const samplesDir = join(process.cwd(), 'sample-files')
  
  try {
    mkdirSync(samplesDir, { recursive: true })
  } catch {
    // Directory already exists
  }
  
  const files = []
  
  // Sample project report
  const projectReport = `# AI Project Analysis Report

## Executive Summary
This comprehensive analysis evaluates the performance and impact of our AI-powered document processing system implemented in Q3 2024.

## Key Metrics
- Processing speed: 95% improvement over manual methods
- Accuracy rate: 98.5% for document classification
- Cost reduction: $150,000 annually
- User satisfaction: 4.8/5.0

## Technical Implementation
### Architecture
- Microservices-based design
- AWS Bedrock integration
- Real-time processing pipeline
- Automated quality assurance

### Performance Data
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Processing Time | 45 min | 2.3 min | 95% |
| Accuracy | 87% | 98.5% | 13% |
| Cost per Document | $5.50 | $0.75 | 86% |

## Recommendations
1. Expand to additional document types
2. Implement batch processing for large volumes
3. Add multi-language support
4. Integrate with existing CRM systems

## Conclusion
The AI document processing system has exceeded all performance targets and is ready for full production deployment.

Contact: project-lead@company.com
Date: 2024-09-15`

  const reportPath = join(samplesDir, 'ai-project-report.md')
  writeFileSync(reportPath, projectReport)
  files.push(reportPath)
  
  // Sample meeting notes
  const meetingNotes = `# Weekly Team Meeting - September 18, 2024

## Attendees
- Sarah Johnson (Product Manager)
- Mike Chen (Lead Developer)  
- Lisa Wang (UX Designer)
- David Rodriguez (Data Scientist)

## Agenda Items

### 1. AI Integration Progress
- Successfully integrated Claude Sonnet 4 with our document analysis pipeline
- Achieved 98.5% accuracy in document classification
- Processing time reduced from 45 minutes to 2.3 minutes per document
- Cost per document decreased by 86%

### 2. User Feedback
- Users report significant time savings
- Interface is intuitive and easy to use
- Request for batch processing feature
- Need for multi-language support

### 3. Technical Challenges
- Memory optimization for large files
- Error handling improvements needed
- Rate limiting considerations for API calls

### 4. Next Sprint Planning
Priority features:
1. Batch file processing
2. Advanced error handling  
3. Performance monitoring dashboard
4. API rate limiting implementation

## Action Items
- [ ] Mike: Implement batch processing by Sept 25
- [ ] Lisa: Design monitoring dashboard mockups
- [ ] David: Optimize memory usage for large files
- [ ] Sarah: Document user requirements for multi-language support

## Metrics This Week
- Documents processed: 1,247
- Average processing time: 2.1 minutes
- User satisfaction score: 4.8/5.0
- System uptime: 99.7%

Next meeting: September 25, 2024 at 10:00 AM`

  const notesPath = join(samplesDir, 'team-meeting-notes.md')
  writeFileSync(notesPath, meetingNotes)
  files.push(notesPath)
  
  // Sample user feedback
  const userFeedback = `# User Feedback Compilation

## Positive Feedback

"The new AI document processor is amazing! What used to take me hours now takes just a few minutes. The accuracy is impressive too." - Marketing Manager

"I love how intuitive the interface is. Even complex documents are processed correctly on the first try." - Legal Assistant

"The cost savings are significant. We're processing 10x more documents with the same budget." - Finance Director

## Improvement Suggestions

"Would love to see batch processing for multiple files at once." - Operations Manager

"Multi-language support would be helpful for our international documents." - HR Director

"A progress indicator during processing would improve the user experience." - Content Specialist

## Technical Feedback

"Integration with our existing CRM system would streamline our workflow." - Sales Manager

"Real-time collaboration features would be valuable for team projects." - Project Coordinator

"Mobile app version would allow processing on the go." - Field Representative

## Ratings Summary
- Ease of Use: 4.9/5.0
- Processing Speed: 4.8/5.0
- Accuracy: 4.7/5.0  
- Overall Satisfaction: 4.8/5.0

## Common Requests
1. Batch processing (mentioned 12 times)
2. Multi-language support (mentioned 8 times)
3. Mobile app (mentioned 6 times)
4. CRM integration (mentioned 5 times)
5. Real-time collaboration (mentioned 4 times)

Total responses: 127
Response rate: 89%
Collection period: September 1-15, 2024`

  const feedbackPath = join(samplesDir, 'user-feedback.md')
  writeFileSync(feedbackPath, userFeedback)
  files.push(feedbackPath)
  
  return files
}

async function main() {
  console.log('🚀 Agentic Bedrock File Upload and Analysis Example\n')

  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE) {
    console.error('❌ AWS credentials not found.')
    process.exit(1)
  }

  try {
    console.log('📁 Creating sample files for analysis...')
    const sampleFiles = createSampleFiles()
    console.log(`✅ Created ${sampleFiles.length} sample files`)
    
    console.log('🔗 Connecting to AWS Bedrock...')
    const model = await getModel('claude4')
    
    console.log('🏭 Creating document analysis agent...')
    
    const agentFactory = createExperimentalAgentFactory()

    const agents = agentFactory.defineAgents({
      documentAnalyst: {
        name: 'AI Document Analysis Agent',
        system: `You are an expert document analysis assistant with capabilities to:

1. Extract and analyze content from various file formats
2. Compare multiple documents for similarities and differences
3. Search for specific content patterns across files
4. Provide detailed insights and recommendations

You have access to powerful file processing tools that can:
- Analyze document structure and content
- Extract key data points, metrics, and insights
- Compare documents for content analysis
- Search across multiple files for specific information

Always provide comprehensive analysis with actionable insights. Use the available tools to thoroughly examine uploaded documents and provide valuable feedback to users.`,
        
        model,
        tools: {
          fileExtraction: fileExtractionTool,
          documentComparison: documentComparisonTool,
          contentSearch: contentSearchTool
        },
        
        maxSteps: 8,
        stopAfterTools: ['fileExtraction', 'documentComparison', 'contentSearch'],
        temperature: 0.3,
        maxOutputTokens: 3000
      }
    })

    const agent = agents.get('documentAnalyst')
    console.log(`✅ Created agent: ${agent.getName()}\n`)

    console.log('=' + '='.repeat(80))
    console.log('DOCUMENT ANALYSIS DEMONSTRATION')
    console.log('=' + '='.repeat(80))

    // ==========================================
    // DEMO 1: Single File Analysis
    // ==========================================
    console.log('\n🔄 DEMO 1: Single Document Analysis')
    console.log('-'.repeat(50))

    const prompt1 = `Please analyze the AI project report file for key insights, metrics, and recommendations. I'm particularly interested in the performance improvements and cost savings mentioned.

File to analyze: ${sampleFiles[0]}`

    console.log(`👤 User: ${prompt1}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult1 = await agent.streamGenerate(prompt1)
    let response1 = ''
    
    for await (const chunk of streamResult1.textStream) {
      process.stdout.write(chunk)
      response1 += chunk
    }
    
    const finalResult1 = await streamResult1.getFinalResult()
    console.log(`\n\n📊 Demo 1 Results: ${finalResult1.usage?.totalTokens} tokens, ${finalResult1.toolCalls?.length || 0} tools`)

    // ==========================================
    // DEMO 2: Multi-Document Comparison
    // ==========================================
    console.log('\n\n🔄 DEMO 2: Multi-Document Comparison Analysis')
    console.log('-'.repeat(50))

    const prompt2 = `I'd like you to compare these three documents to understand the overall project status and identify common themes:

1. ${sampleFiles[0]} (project report)
2. ${sampleFiles[1]} (meeting notes) 
3. ${sampleFiles[2]} (user feedback)

Please compare their content and tell me what the overall picture is regarding our AI project.`

    console.log(`👤 User: ${prompt2}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult2 = await agent.streamGenerate(prompt2)
    let response2 = ''
    
    for await (const chunk of streamResult2.textStream) {
      process.stdout.write(chunk)
      response2 += chunk
    }
    
    const finalResult2 = await streamResult2.getFinalResult()
    console.log(`\n\n📊 Demo 2 Results: ${finalResult2.usage?.totalTokens} tokens, ${finalResult2.toolCalls?.length || 0} tools`)

    // ==========================================
    // DEMO 3: Content Search Across Files
    // ==========================================
    console.log('\n\n🔄 DEMO 3: Content Search Across Documents')
    console.log('-'.repeat(50))

    const prompt3 = `I need to find all mentions of "batch processing" across our project documents. This is an important feature request that keeps coming up. Please search for this term and related concepts across all the uploaded files.

Files to search: ${sampleFiles.join(', ')}`

    console.log(`👤 User: ${prompt3}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult3 = await agent.streamGenerate(prompt3)
    let response3 = ''
    
    for await (const chunk of streamResult3.textStream) {
      process.stdout.write(chunk)
      response3 += chunk
    }
    
    const finalResult3 = await streamResult3.getFinalResult()
    console.log(`\n\n📊 Demo 3 Results: ${finalResult3.usage?.totalTokens} tokens, ${finalResult3.toolCalls?.length || 0} tools`)

    // ==========================================
    // DEMO 4: Data Extraction and Analysis
    // ==========================================
    console.log('\n\n🔄 DEMO 4: Detailed Data Extraction')
    console.log('-'.repeat(50))

    const prompt4 = `Please extract all quantitative metrics, performance data, and numerical KPIs from the project report. I need this data for an executive summary presentation.

Focus on extracting: completion rates, time savings, cost reductions, user satisfaction scores, and any other measurable outcomes.`

    console.log(`👤 User: ${prompt4}\n`)
    console.log('🤖 Assistant: ')
    
    const streamResult4 = await agent.streamGenerate(prompt4)
    let response4 = ''
    
    for await (const chunk of streamResult4.textStream) {
      process.stdout.write(chunk)
      response4 += chunk
    }
    
    const finalResult4 = await streamResult4.getFinalResult()
    console.log(`\n\n📊 Demo 4 Results: ${finalResult4.usage?.totalTokens} tokens, ${finalResult4.toolCalls?.length || 0} tools`)

    // ==========================================
    // SUMMARY AND ANALYSIS
    // ==========================================
    console.log('\n\n' + '=' + '='.repeat(80))
    console.log('FILE ANALYSIS SUMMARY')
    console.log('=' + '='.repeat(80))

    const totalTokens = [
      finalResult1.usage?.totalTokens,
      finalResult2.usage?.totalTokens,
      finalResult3.usage?.totalTokens,
      finalResult4.usage?.totalTokens
    ].filter(Boolean).reduce((sum, tokens) => sum + (tokens || 0), 0)

    const totalToolCalls = [
      finalResult1.toolCalls?.length || 0,
      finalResult2.toolCalls?.length || 0,
      finalResult3.toolCalls?.length || 0,
      finalResult4.toolCalls?.length || 0
    ].reduce((sum, calls) => sum + calls, 0)

    console.log(`\n📊 Analysis Statistics:`)
    console.log(`   Files processed: ${sampleFiles.length}`)
    console.log(`   Total token usage: ${totalTokens}`)
    console.log(`   Total tool calls: ${totalToolCalls}`)
    console.log(`   File types analyzed: Markdown, text documents`)
    
    if (totalTokens > 0) {
      const estimatedCost = (totalTokens / 1000) * 0.009
      console.log(`   Estimated cost: $${estimatedCost.toFixed(4)}`)
    }

    console.log('\n🎯 File Processing Capabilities Demonstrated:')
    console.log('   ✓ Single document analysis with detailed insights')
    console.log('   ✓ Multi-document comparison and synthesis')
    console.log('   ✓ Content search across multiple files')
    console.log('   ✓ Quantitative data extraction and analysis')
    console.log('   ✓ Intelligent content understanding and recommendations')
    console.log('   ✓ Agentic behavior with file processing tools')

    console.log('\n💡 Real-world Applications:')
    console.log('   • Document review and compliance checking')
    console.log('   • Research paper analysis and synthesis')
    console.log('   • Contract comparison and risk assessment')
    console.log('   • Report generation from multiple data sources')
    console.log('   • Content audit and quality assurance')
    console.log('   • Knowledge extraction from document libraries')

    console.log('\n📁 Sample files created in: ./sample-files/')
    console.log('   You can modify these files or add your own for testing!')

    console.log('\n✅ File Upload and Analysis Demo Complete!')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main().catch(console.error)
