import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname as pathDirname, join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { getModel } from '@airo/ai-lib'
import { createAgentFactory } from '@airo/ai-lib'

const __filename = fileURLToPath(import.meta.url)
const __dirname = pathDirname(__filename)

dotenv.config({ path: join(__dirname, '../.env.local') })
dotenv.config({ path: join(__dirname, '../.env') })

const RAG_FILE = process.env.RAG_FILE || './output/design-trends-rag.json'
const OUTPUT_DIR = process.env.OUTPUT_DIR || './output'
const STYLE_NAME = process.env.STYLE_NAME || null

const CLASSIC_STYLES = [
  {
    name: 'Swiss/International Style',
    description: 'Grid systems, sans-serif typography, objectivity'
  },
  {
    name: 'Brutalism',
    description: 'Raw, unpolished, honest materials, bold typography'
  },
  {
    name: 'Bauhaus',
    description: 'Form follows function, geometric shapes, primary colors'
  },
  {
    name: 'Art Deco',
    description: 'Geometric patterns, luxury, symmetry, bold colors'
  },
  {
    name: 'Memphis Design',
    description: 'Bright colors, geometric shapes, pattern chaos'
  },
  {
    name: 'Flat Design',
    description: 'Simplified elements, bright colors, 2D illustrations'
  },
  {
    name: 'Skeuomorphism',
    description: 'Realistic textures, shadows, depth'
  },
  {
    name: 'Neumorphism',
    description: 'Soft UI, subtle shadows, extruded elements'
  },
  {
    name: 'Glassmorphism',
    description: 'Transparency, blur effects, layering'
  }
]

interface DesignTrendRAG {
  trendName: string
  pages: number[]
  overviewImage: string
  assetsImage: string
  extractedText: string
  trend: any
}

interface StyleOutput {
  styleName: string
  description: string
  relatedTrends: string[]
  visualCharacteristics: string[]
  typographyGuidance: string
  colorPaletteGuidance: string
  layoutPrinciples: string[]
  modernApplications: string[]
  exampleUseCases: string[]
  generatedAt: string
}

async function main() {
  console.log('Starting style generation process...')
  
  if (!existsSync(RAG_FILE)) {
    console.error(`RAG file not found at: ${RAG_FILE}`)
    console.error('Please run extraction first or set RAG_FILE environment variable')
    process.exit(1)
  }
  
  if (!process.env.AWS_ACCESS_KEY_ID && !process.env.AWS_PROFILE && !process.env.OPENAI_API_KEY) {
    console.error('No AI provider credentials found.')
    console.error('Set AWS_ACCESS_KEY_ID/AWS_PROFILE for Bedrock or OPENAI_API_KEY for OpenAI')
    process.exit(1)
  }
  
  console.log(`Loading RAG data from: ${RAG_FILE}`)
  const ragDataRaw = readFileSync(RAG_FILE, 'utf-8')
  const ragData: DesignTrendRAG[] = JSON.parse(ragDataRaw)
  console.log(`Loaded ${ragData.length} design trends`)
  
  const ragContext = ragData.map(trend => ({
    name: trend.trendName,
    description: trend.trend.description,
    visualStyle: trend.trend.visualStyle,
    keyCharacteristics: trend.trend.keyCharacteristics,
    visualEffects: trend.trend.visualEffects,
    colorSchemes: trend.trend.colorSchemes,
    typographyStyles: trend.trend.typographyStyles,
    industries: trend.trend.industries,
    graphicElements: trend.trend.graphicElements
  }))
  
  const ragContextString = JSON.stringify(ragContext, null, 2)
  
  const stylesToProcess = STYLE_NAME
    ? CLASSIC_STYLES.filter(s => s.name === STYLE_NAME)
    : CLASSIC_STYLES
  
  if (STYLE_NAME && stylesToProcess.length === 0) {
    console.error(`STYLE_NAME "${STYLE_NAME}" not found in classic styles`)
    process.exit(1)
  }
  
  if (STYLE_NAME) {
    console.log(`Processing only: "${STYLE_NAME}"`)
  }
  
  const model = await getModel('claude4')
  console.log('Connected to AI model')
  
  const agentFactory = createAgentFactory()
  
  const agents = agentFactory.defineAgents({
    styleGenerator: {
      name: 'Design Style Generator',
      system: `You are a design expert who analyzes classic design styles and relates them to contemporary design trends.

You will be provided with:
1. A classic design style name and brief description
2. A comprehensive database of current design trends with detailed characteristics

Your task is to:
- Analyze the classic style in depth
- Find connections and similarities with the current trends in the database
- Generate comprehensive guidance for applying this classic style in modern contexts
- Provide specific, actionable design recommendations

CRITICAL: Respond with valid JSON only. No explanations, no markdown code blocks.

JSON structure:
{
  "styleName": "the style name",
  "description": "detailed description of the classic style",
  "relatedTrends": ["list of trend names from the database that share similarities"],
  "visualCharacteristics": ["detailed list of visual characteristics"],
  "typographyGuidance": "comprehensive typography guidance with specific recommendations",
  "colorPaletteGuidance": "detailed color palette guidance with specific color recommendations",
  "layoutPrinciples": ["list of layout principles and composition rules"],
  "modernApplications": ["how to apply this style in modern design contexts"],
  "exampleUseCases": ["specific use cases and project types where this style excels"]
}`,
      
      model,
      tools: {},
      maxSteps: 1,
      temperature: 0.3,
      maxOutputTokens: 4000
    }
  })
  
  const agent = agents.get('styleGenerator')
  console.log('Created style generator agent\n')
  
  mkdirSync(OUTPUT_DIR, { recursive: true })
  const allStyles: StyleOutput[] = []
  
  for (const style of stylesToProcess) {
    console.log(`\nGenerating style guide for: ${style.name}...`)
    
    try {
      const prompt = `Analyze the classic design style: "${style.name}"

Brief description: ${style.description}

Use the following database of current design trends to find connections and inform your analysis:

${ragContextString}

Generate a comprehensive style guide that connects this classic style with current trends.`
      
      const streamResult = await agent.streamGenerate(prompt)
      
      let response = ''
      
      for await (const chunk of streamResult.textStream) {
        response += chunk
      }
      
      const finalResult = await streamResult.getFinalResult()
      
      let styleOutput: StyleOutput
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          styleOutput = JSON.parse(jsonMatch[0])
        } else {
          styleOutput = JSON.parse(response)
        }
      } catch (parseError) {
        console.log(`  Warning: Could not parse JSON response`)
        console.log(`  Response preview: ${response.substring(0, 200)}`)
        throw parseError
      }
      
      styleOutput.generatedAt = new Date().toISOString()
      allStyles.push(styleOutput)
      
      console.log(`  ✓ Successfully generated: ${styleOutput.styleName}`)
      console.log(`  Related trends: ${styleOutput.relatedTrends.join(', ')}`)
      console.log(`  Tokens: ${finalResult.usage?.totalTokens || 0}`)
      
    } catch (error) {
      console.error('  ✗ Error processing style:', style.name, error instanceof Error ? error.message : String(error))
    }
  }
  
  const outputFile = join(OUTPUT_DIR, 'classic-styles.json')
  writeFileSync(outputFile, JSON.stringify(allStyles, null, 2))
  console.log(`\nGeneration complete!`)
  console.log(`Output written to: ${outputFile}`)
  
  console.log(`\nSummary:`)
  console.log(`  Styles processed: ${allStyles.length}/${CLASSIC_STYLES.length}`)
  console.log(`  Successful: ${allStyles.length}`)
}

main().catch(console.error)
