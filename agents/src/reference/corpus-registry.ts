import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Corpus {
  id: string
  baseDir: string
  description: string
}

const referenceDir: string = path.dirname(fileURLToPath(import.meta.url))

const CORPORA = {
  'template-v8': {
    id: 'template-v8',
    baseDir: path.join(referenceDir, 'corpora', 'template-v8'),
    description:
      'v8 web app template: stack, routing, layouts, components, API handlers, media slots.',
  },
} satisfies Record<string, Corpus>

/** Valid corpus ids. Internal callers should prefer this; the tool boundary still takes `string`. */
export type CorpusId = keyof typeof CORPORA

export const DEFAULT_CORPUS_ID: CorpusId = 'template-v8'

// Accepts `string` (not CorpusId) on purpose: the reference tool forwards an
// arbitrary corpus name from the model, so the unknown-corpus check is a runtime
// guard on untrusted input, not just a type-level concern.
export function getCorpus(corpusId: string): Corpus {
  if (!(corpusId in CORPORA)) {
    throw new Error(
      `Unknown reference corpus "${corpusId}". Available: ${Object.keys(CORPORA).join(', ')}`
    )
  }
  return CORPORA[corpusId as CorpusId]
}

export function listCorpora(): Corpus[] {
  return Object.values(CORPORA)
}
