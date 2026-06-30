import type { Dirent } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { getCorpus, DEFAULT_CORPUS_ID } from './corpus-registry.js'

export interface DocEntry {
  path: string
  title: string
}

export interface SearchHit {
  path: string
  title: string
  snippets: string[]
}

function validateRelPath(relPath: string): void {
  if (!relPath || relPath.length === 0) {
    throw new Error('path must not be empty')
  }
  if (relPath.startsWith('/')) {
    throw new Error('path must not be absolute')
  }
  if (relPath.includes('..')) {
    throw new Error('path must not contain ".."')
  }
  if (!relPath.endsWith('.md')) {
    throw new Error('path must end with ".md"')
  }
}

function firstHeading(content: string): string {
  for (const line of content.split('\n')) {
    const match: RegExpMatchArray | null = line.match(/^#\s+(.+)$/)
    if (match) {
      return match[1]!.trim()
    }
  }
  return ''
}

async function listMarkdownFiles(baseDir: string, prefix: string = ''): Promise<string[]> {
  const entries: Dirent[] = await readdir(baseDir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const relativePath: string = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      const nested: string[] = await listMarkdownFiles(path.join(baseDir, entry.name), relativePath)
      results.push(...nested)
    } else if (entry.name.endsWith('.md')) {
      results.push(relativePath)
    }
  }
  return results.sort()
}

export async function listDocs(corpusId: string = DEFAULT_CORPUS_ID): Promise<DocEntry[]> {
  const baseDir: string = getCorpus(corpusId).baseDir
  const names: string[] = await listMarkdownFiles(baseDir)
  const entries: DocEntry[] = []
  for (const name of names) {
    const content: string = await readFile(path.join(baseDir, name), 'utf-8')
    entries.push({ path: name, title: firstHeading(content) })
  }
  return entries
}

export async function readDoc(relPath: string, corpusId: string = DEFAULT_CORPUS_ID): Promise<string> {
  validateRelPath(relPath)
  const baseResolved: string = path.resolve(getCorpus(corpusId).baseDir)
  const full: string = path.resolve(baseResolved, relPath)
  if (full !== baseResolved && !full.startsWith(baseResolved + path.sep)) {
    throw new Error(`path "${relPath}" resolves outside the corpus`)
  }
  return readFile(full, 'utf-8')
}

export async function searchDocs(query: string, corpusId: string = DEFAULT_CORPUS_ID): Promise<SearchHit[]> {
  if (!query || query.trim().length === 0) {
    throw new Error('query must not be empty')
  }
  const needle: string = query.toLowerCase()
  const baseDir: string = getCorpus(corpusId).baseDir
  const names: string[] = await listMarkdownFiles(baseDir)
  const hits: SearchHit[] = []
  for (const name of names) {
    const content: string = await readFile(path.join(baseDir, name), 'utf-8')
    const snippets: string[] = content
      .split('\n')
      .filter((line: string) => line.toLowerCase().includes(needle))
      .slice(0, 5)
      .map((line: string) => line.trim())
    if (snippets.length > 0) {
      hits.push({ path: name, title: firstHeading(content), snippets })
    }
  }
  return hits
}
