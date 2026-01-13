import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'
import { GrepTool, GrepOptions } from '../grep-tool.js'
import { AppRepository } from '../../database/repositories/AppRepository.js'

// Initialize tool instances
const appRepo = new AppRepository()

/**
 * Grep Search Tool for AI-Lib
 * Search for text or patterns across files in the project
 */
export const grepSearchAITool: Tool = createTool(
  'Search for text or patterns across files in the project. Essential for finding code to edit without reading entire files, locating function/class definitions, finding all usages of a symbol, searching for TODOs or specific patterns, and understanding code structure before making changes.',
  z.object({
    query: z.string().describe('Text or regex pattern to search for'),
    paths: z.array(z.string()).optional().describe('Specific files or directories to search in. If not provided, searches entire project'),
    regex: z.boolean().default(false).describe('Treat query as a regular expression'),
    caseSensitive: z.boolean().default(false).describe('Case-sensitive search'),
    wholeWord: z.boolean().default(false).describe('Match whole words only'),
    contextLines: z.number().default(3).describe('Number of lines to show before and after each match'),
    maxResults: z.number().default(50).describe('Maximum number of results to return'),
    maxFilesSearched: z.number().default(1000).describe('Maximum number of files to search through'),
    includePatterns: z.array(z.string()).default(['**/*.{ts,tsx,js,jsx,py,java,cpp,c,go,rs,rb,php,swift,kt,scala,r,m,html,css,scss,json,yaml,yml,toml,xml,md,txt}']).describe('Glob patterns for files to include'),
    excludePatterns: z.array(z.string()).default(['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**', '**/*.min.js', '**/vendor/**', '**/tmp/**', '**/.next/**', '**/.cache/**']).describe('Glob patterns for files to exclude'),
    includeLineNumbers: z.boolean().default(true).describe('Include line numbers in results'),
    includePath: z.boolean().default(true).describe('Include file paths in results'),
    groupByFile: z.boolean().default(true).describe('Group results by file'),
    findDefinition: z.boolean().default(false).describe('Try to find function/class/variable definitions'),
    findReferences: z.boolean().default(false).describe('Try to find all references/usages')
  }),
  async (input, context) => {
    const appId = context?.metadata?.appId as string
    if (!appId) {
      throw new Error('App ID is required for grep search')
    }

    const app = appRepo.findById(appId)
    if (!app) {
      throw new Error(`App '${appId}' not found`)
    }

    const appGrepTool = new GrepTool(app.path, appId)
    const result = await appGrepTool.execute(input as GrepOptions)
    return appGrepTool.formatForLLM(result)
  }
)
