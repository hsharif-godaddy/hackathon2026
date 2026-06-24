import { Logger } from '../logging/index.js'
import { DEFAULT_CORPUS_ID } from '../reference/corpus-registry.js'
import { listDocs, readDoc } from '../reference/reference-service.js'

const logger = Logger.create({ component: 'template-context' })

export type TemplateContextConfig =
  | { mode: 'none' }
  | { mode: 'summary' }
  | { mode: 'listing' }
  | { mode: 'files'; paths: string[] }

export async function resolveTemplateContext(
  config: TemplateContextConfig,
  corpusId: string = DEFAULT_CORPUS_ID
): Promise<string> {
  switch (config.mode) {
    case 'none':
      return ''

    case 'summary': {
      try {
        return await readDoc('summary.md', corpusId)
      } catch (err: unknown) {
        logger.warn('template-context.summary.read_failed', {
          corpusId,
          error: err instanceof Error ? err.message : String(err),
        })
        return ''
      }
    }

    case 'listing': {
      try {
        const docs = await listDocs(corpusId)
        return docs.map((d) => `- ${d.path}`).join('\n')
      } catch (err: unknown) {
        logger.warn('template-context.listing.read_failed', {
          corpusId,
          error: err instanceof Error ? err.message : String(err),
        })
        return ''
      }
    }

    case 'files': {
      const contents: string[] = []
      for (const relativePath of config.paths) {
        try {
          contents.push(await readDoc(relativePath, corpusId))
        } catch {
          // Skip missing files — expected when a requested doc isn't in the corpus.
        }
      }
      return contents.join('\n---\n')
    }
  }
}
