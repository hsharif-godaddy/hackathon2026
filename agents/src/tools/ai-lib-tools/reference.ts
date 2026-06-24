import { createTool, type Tool } from '@airo/ai-lib'
import { z } from 'zod'

import { Logger } from '../../logging/index.js'
import { DEFAULT_CORPUS_ID } from '../../reference/corpus-registry.js'
import { listDocs, readDoc, searchDocs } from '../../reference/reference-service.js'

const logger = Logger.create({ component: 'reference-tool' })

export const referenceAITool: Tool = createTool(
  `Read curated reference documentation. Operations:
- "list": list available reference docs (path + title) in a corpus.
- "read": return the full markdown of one doc (requires path, e.g. "routing.md").
- "search": case-insensitive keyword search across docs (requires query); returns matching docs with snippets.
Defaults to the "template-v8" corpus describing this app's tech stack and conventions.`,
  z.object({
    operation: z.enum(['list', 'read', 'search']).describe('"list", "read", or "search"'),
    corpus: z.string().optional().describe('Corpus id. Defaults to "template-v8".'),
    path: z.string().optional().describe('For "read": corpus-relative doc path, e.g. "routing.md".'),
    query: z.string().optional().describe('For "search": keyword/substring to find.'),
  }),
  async (input): Promise<Record<string, unknown>> => {
    const corpus: string = input.corpus ?? DEFAULT_CORPUS_ID
    try {
      if (input.operation === 'list') {
        return { ok: true, corpus, docs: await listDocs(corpus) }
      }
      if (input.operation === 'read') {
        if (!input.path) {
          throw new Error('path is required for operation "read"')
        }
        return { ok: true, corpus, path: input.path, content: await readDoc(input.path, corpus) }
      }
      if (!input.query) {
        throw new Error('query is required for operation "search"')
      }
      return { ok: true, corpus, query: input.query, hits: await searchDocs(input.query, corpus) }
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err)
      logger.warn('reference.error', { operation: input.operation, corpus, error: message })
      return { ok: false, error: message }
    }
  }
)
