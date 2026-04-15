import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname as pathDirname, join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { fromPath } from 'pdf2pic'
import { getModel } from '@airo/ai-lib'
import { createAgentFactory } from '@airo/ai-lib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = pathDirname(__filename)

dotenv.config({ path: join(__dirname, '../.env.local') })
dotenv.config({ path: join(__dirname, '../.env') })

const PDF_PATH = process.env.PDF_PATH || '/tmp/design.pdf'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output'
const TEMP_IMG_DIR = join(OUTPUT_DIR, 'temp-images')
const TEST_TREND = process.env.TEST_TREND || null

const TREND_PAGE_INDEX = [
  { name: 'Diffused Worlds', startPage: 4 },
  { name: 'Newstalgia', startPage: 6 },
  { name: 'Neo-Nostalgic Patterns', startPage: 8 },
  { name: 'Scroll Stopping Scrapbook', startPage: 10 },
  { name: 'Ethereal Reverie', startPage: 12 },
  { name: 'Power of Gaia', startPage: 14 },
  { name: 'Retro Luxe Rebellion', startPage: 16 },
  { name: 'The Pixel Effect', startPage: 18 },
  { name: 'Playful Classicism', startPage: 20 },
  { name: 'Socie(tea)', startPage: 22 },
  { name: 'Butter Yellow', startPage: 24 },
  { name: 'Bento Blocks', startPage: 27 },
  { name: 'Outlined Play', startPage: 29 },
  { name: 'Type Minimalism', startPage: 31 },
  { name: 'Retro Scrapbook', startPage: 33 },
  { name: 'Floating Minimalism', startPage: 35 }
]

interface VisualEffects {
  distortionTechniques: string[]
  effectsPlacement: string[]
  technicalEffects: string[]
  colorEffects: string[]
  layeringTechniques: string[]
  typographyInteraction: string
  primarySubjects: string[]
  effectIntensity: 'subtle' | 'moderate' | 'extreme'
}

interface DesignTrend {
  name: string
  ranking?: number
  description: string
  visualStyle: string
  keyCharacteristics: string[]
  visualEffects: VisualEffects
  colorSchemes?: string[]
  typographyStyles?: string[]
  useCases?: string[]
  industries?: string[]
  fonts?: string[]
  graphicElements?: string[]
}

interface TrendExtraction {
  trendName: string
  pageRange: [number, number]
  overviewImagePath: string
  assetsImagePath: string
  extractedText: string
  trend: DesignTrend
  extractedAt: string
}

async function extractPDFText(pdfPath: string): Promise<Map<number, string>> {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
  
  const dataBuffer = readFileSync(pdfPath)
  const data = new Uint8Array(dataBuffer)
  const loadingTask = pdfjsLib.getDocument({ data })
  const pdfDoc = await loadingTask.promise
  
  const pageTexts = new Map<number, string>()
  
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ')
    pageTexts.set(pageNum, pageText.trim())
  }
  
  return pageTexts
}

async function convertPDFPageToImage(pdfPath: string, outputDir: string, pageNumber: number): Promise<string> {
  mkdirSync(outputDir, { recursive: true })
  
  const converter = fromPath(pdfPath, {
    density: 150,
    saveFilename: `page-${pageNumber}`,
    savePath: outputDir,
    format: 'jpg',
    width: 3000,
    preserveAspectRatio: true
  })
  
  const result = await converter(pageNumber, { responseType: 'image' })
  
  if (!result.path) {
    throw new Error(`Failed to convert page ${pageNumber}`)
  }
  
  return result.path
}

function imageToBase64(imagePath: string): string {
  const buffer = readFileSync(imagePath)
  return buffer.toString('base64')
}

async function main() {
  console.log('Starting PDF design extraction process...')
  
  if (!existsSync(PDF_PATH)) {
    console.error(`PDF file not found at: ${PDF_PATH}`)
    console.error('Please set PDF_PATH environment variable or place PDF at /tmp/design.pdf')
    process.exit(1)
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('No AI provider credentials found.')
    console.error('Set OPENAI_API_KEY environment variable')
    process.exit(1)
  }
  
  mkdirSync(OUTPUT_DIR, { recursive: true })
  
  const trendsToProcess = TEST_TREND 
    ? TREND_PAGE_INDEX.filter(t => t.name === TEST_TREND)
    : TREND_PAGE_INDEX
  
  if (TEST_TREND && trendsToProcess.length === 0) {
    console.error(`TEST_TREND "${TEST_TREND}" not found in index`)
    process.exit(1)
  }
  
  if (TEST_TREND) {
    console.log(`TEST MODE: Processing only "${TEST_TREND}" trend`)
  }
  
  console.log(`Extracting text from PDF: ${PDF_PATH}`)
  const pageTexts = await extractPDFText(PDF_PATH)
  console.log(`Extracted text from ${pageTexts.size} pages`)
  
  const model = await getModel('claude-sonnet-4-6')
  console.log('Connected to AI model')
  
  const agentFactory = createAgentFactory()
  
  const agents = agentFactory.defineAgents({
    designExtractor: {
      name: 'Design Trends Extraction Agent',
      system: `You are a design trend analyst. Extract comprehensive information about the design trend from the provided images and text.

You will receive:
1. An overview image showing the trend concept
2. An assets/examples image showing visual elements
3. Extracted text from both pages

Extract the following:
- Trend name (should match the expected name)
- Complete description of the trend
- Visual style characteristics
- Key characteristics and attributes
- Color schemes visible in the images
- Typography styles shown
- Use cases mentioned or implied
- Industries that would benefit
- Named fonts if visible
- Graphic elements and design patterns

## Visual Effect Analysis
Carefully analyze the images and provide detailed observations:

1. **Distortion/Blur Techniques**: Identify any distortion or blur effects (motion blur, gaussian blur, radial blur, warping, refraction, ripples, defocus, lens effects, etc.). If none are present, return empty array.

2. **Effects Placement**: Note where visual effects are applied - backgrounds only, foreground subjects only, or both. Consider composition and depth.

3. **Technical Effects**: Identify any technical or digital effects visible (scan lines, glitch, pixelation, halftone, noise, grain, VHS artifacts, datamoshing, digital distortion, screen effects, etc.). If none present, return empty array.

4. **Color Effects**: Identify color-based effects (chromatic aberration, RGB splitting, color fringing, duotone, gradient mapping, color grading, vintage color shifts, desaturation, oversaturation, color channel separation, etc.). If none present, return empty array.

5. **Layering Techniques**: Note compositing and layering (double exposure, multiple exposures, opacity blending, overlays, collage, cutouts, masked elements, etc.). If none present, return empty array.

6. **Typography Interaction**: Describe how typography relates to visual elements - does it overlay effects, get distorted itself, remain clean and separate, integrate with imagery, use transparency, etc.

7. **Primary Subjects**: Identify the main visual subjects (portraits, photography, illustrations, abstract shapes, patterns, textures, 3D elements, typography-focused, etc.)

8. **Effect Intensity**: Rate the overall intensity of visual manipulation as subtle (minimal effects), moderate (noticeable but balanced), or extreme (heavy manipulation, highly stylized)

CRITICAL: Respond with valid JSON only. No explanations, no markdown.

JSON structure:
{
  "name": "trend name",
  "description": "comprehensive description",
  "visualStyle": "detailed visual style description",
  "keyCharacteristics": ["characteristic 1", "characteristic 2"],
  "visualEffects": {
    "distortionTechniques": ["list specific techniques or empty array if none"],
    "effectsPlacement": ["backgrounds", "subjects", "both", "typography", "overall"],
    "technicalEffects": ["list specific effects or empty array if none"],
    "colorEffects": ["list specific color effects or empty array if none"],
    "layeringTechniques": ["list specific techniques or empty array if none"],
    "typographyInteraction": "description of how type interacts with visual elements",
    "primarySubjects": ["portraits", "photography", "illustrations", "abstract", "patterns", "typography", "3D", "mixed"],
    "effectIntensity": "subtle" | "moderate" | "extreme"
  },
  "colorSchemes": ["#hexcode or color name"],
  "typographyStyles": ["style descriptions"],
  "useCases": ["use case 1"],
  "industries": ["industry 1"],
  "fonts": ["font names if visible"],
  "graphicElements": ["element descriptions"]
}`,
      
      model,
      tools: {},
      maxSteps: 1,
      temperature: 0.2,
      maxOutputTokens: 4000,
      logger: {
        info: (event: string, data: unknown) => console.log(`[INFO] ${event}`, data),
        warn: (event: string, data: unknown) => console.warn(`[WARN] ${event}`, data),
        error: (event: string, data: unknown) => console.error(`[ERROR] ${event}`, data)
      }
    }
  })
  
  const agent = agents.get('designExtractor')
  console.log('Created design extraction agent\n')
  
  const allExtractions: TrendExtraction[] = []
  
  for (const trendInfo of trendsToProcess) {
    const overviewPage = trendInfo.startPage
    const assetsPage = overviewPage + 1
    
    console.log(`\nProcessing trend: ${trendInfo.name} (pages ${overviewPage}-${assetsPage})...`)
    
    try {
      console.log(`  Converting pages to images...`)
      const overviewImagePath = await convertPDFPageToImage(PDF_PATH, TEMP_IMG_DIR, overviewPage)
      const assetsImagePath = await convertPDFPageToImage(PDF_PATH, TEMP_IMG_DIR, assetsPage)
      
      const overviewBase64 = imageToBase64(overviewImagePath)
      const assetsBase64 = imageToBase64(assetsImagePath)
      
      const overviewText = pageTexts.get(overviewPage) || ''
      const assetsText = pageTexts.get(assetsPage) || ''
      const combinedText = `Overview Page Text:\n${overviewText}\n\nAssets Page Text:\n${assetsText}`
      
      console.log(`  Extracting trend data with AI...`)
      
      const prompt = `Analyze this design trend: "${trendInfo.name}"

Extracted text from both pages:
${combinedText}

Provide a comprehensive extraction of all design information visible in the text above.

Note: Image analysis is not currently supported in this extraction tool. Please extract all available information from the text content.`
      
      const streamResult = await agent.streamGenerate(prompt)
      
      let response = ''
      
      for await (const chunk of streamResult.textStream) {
        response += chunk
      }
      
      const finalResult = await streamResult.getFinalResult()
      
      let extractedTrend: DesignTrend
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          extractedTrend = JSON.parse(jsonMatch[0])
        } else {
          extractedTrend = JSON.parse(response)
        }
      } catch (parseError) {
        console.log(`  Warning: Could not parse JSON response`)
        console.log(`  Response preview: ${response.substring(0, 200)}`)
        throw parseError
      }
      
      const trendExtraction: TrendExtraction = {
        trendName: trendInfo.name,
        pageRange: [overviewPage, assetsPage],
        overviewImagePath: overviewImagePath.replace(TEMP_IMG_DIR, 'temp-images'),
        assetsImagePath: assetsImagePath.replace(TEMP_IMG_DIR, 'temp-images'),
        extractedText: combinedText,
        trend: extractedTrend,
        extractedAt: new Date().toISOString()
      }
      
      allExtractions.push(trendExtraction)
      
      console.log(`  ✓ Successfully extracted: ${extractedTrend.name}`)
      console.log(`  Tokens: ${finalResult.usage?.totalTokens || 0}`)
      
    } catch (error) {
      console.error('  ✗ Error processing trend:', trendInfo.name, error instanceof Error ? error.message : String(error))
    }
  }
  
  const outputFile = join(OUTPUT_DIR, 'design-trends.json')
  writeFileSync(outputFile, JSON.stringify(allExtractions, null, 2))
  console.log(`\nExtraction complete!`)
  console.log(`Output written to: ${outputFile}`)
  
  console.log(`\nSummary:`)
  console.log(`  Trends processed: ${allExtractions.length}/${TREND_PAGE_INDEX.length}`)
  console.log(`  Successful: ${allExtractions.length}`)
  
  const ragFile = join(OUTPUT_DIR, 'design-trends-rag.json')
  const ragData = allExtractions.map(extraction => ({
    trendName: extraction.trendName,
    pages: extraction.pageRange,
    overviewImage: extraction.overviewImagePath,
    assetsImage: extraction.assetsImagePath,
    extractedText: extraction.extractedText,
    trend: extraction.trend
  }))
  writeFileSync(ragFile, JSON.stringify(ragData, null, 2))
  console.log(`\nRAG-ready data written to: ${ragFile}`)
  
  console.log(`\nTemporary images saved in: ${TEMP_IMG_DIR}`)
  console.log(`(You can delete these after reviewing the extraction)`)
}

main().catch(console.error)
