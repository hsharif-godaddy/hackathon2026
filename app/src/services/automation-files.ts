import matter from 'gray-matter'

import { Automation } from '@/app/[market]/develop/components/automations/types'
import { logger } from '@/lib/request-context'
import { AppService } from '@/services/AppService'

const JOBS_DIR = '.airo/jobs'
const INDEX_PATH = `${JOBS_DIR}/index.json`

// Serializes concurrent index mutations within a single tab. Cross-tab writes
// are handled by the read-write-verify loop inside each mutation (see create/remove).
const indexLocks = new Map<string, Promise<void>>()

// Retry on 502/503/504 and network-level failures (CORS errors with no status) —
// both indicate a cold-starting container. Uses exponential backoff.
const TRANSIENT_STATUSES = new Set([502, 503, 504])
const INDEX_MERGE_ATTEMPTS = 3

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status
  if (status === undefined) return true
  return TRANSIENT_STATUSES.has(status)
}

async function retryTransient<T>(fn: () => Promise<T>, maxAttempts = 6, baseDelayMs = 1000): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isTransient(err)) throw err
      lastError = err
      if (attempt < maxAttempts - 1) {
        await new Promise<void>(resolve => setTimeout(resolve, baseDelayMs * 2 ** attempt))
      }
    }
  }
  throw lastError
}

async function withIndexLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const prev = indexLocks.get(appId) ?? Promise.resolve()
  let release!: () => void
  const lock = new Promise<void>(r => { release = r })
  indexLocks.set(appId, lock)
  try {
    await prev
    return await fn()
  } finally {
    release()
    if (indexLocks.get(appId) === lock) indexLocks.delete(appId)
  }
}

export type AutomationFile = Omit<Automation, 'isDefault'>

function serialize(automation: Omit<AutomationFile, 'id'>): string {
  return matter.stringify(automation.prompt, {
    name: automation.name,
    description: automation.description,
  })
}

function parse(id: string, content: string): AutomationFile | null {
  try {
    const { data, content: prompt } = matter(content)
    if (typeof data.name !== 'string') return null
    return {
      id,
      name: data.name,
      description: typeof data.description === 'string' ? data.description : '',
      prompt: prompt.trim(),
    }
  } catch {
    return null
  }
}

function generateId(): string {
  return crypto.randomUUID()
}

async function readIndex(appId: string): Promise<string[]> {
  const appService = AppService.getInstance()
  try {
    const { content } = await retryTransient(() => appService.readFile(appId, INDEX_PATH))
    if (!content) return []
    try {
      const parsed = JSON.parse(content)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // Malformed JSON (e.g. from a partial/interrupted write) — treat as empty
      // rather than bricking the feature permanently with no user-recoverable path.
      logger.warn('automation-files.index.malformed', { appId })
      return []
    }
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 404) return []
    logger.warn('automation-files.index.read-error', {
      appId,
      status,
      message: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

async function writeIndex(appId: string, ids: string[]): Promise<void> {
  const appService = AppService.getInstance()
  await appService.writeFile(appId, INDEX_PATH, JSON.stringify(ids, null, 2))
}

export async function list(appId: string): Promise<AutomationFile[]> {
  const appService = AppService.getInstance()
  const ids = await readIndex(appId)

  const results = await Promise.allSettled(
    ids.map(id => retryTransient(() => appService.readFile(appId, `${JOBS_DIR}/${id}/${id}.md`)).then(({ content }) => ({ id, content })))
  )

  const automations: AutomationFile[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const id = ids[i]
    if (result.status === 'rejected') {
      const status = (result.reason as { status?: number }).status
      if (status !== 404) {
        logger.warn('automation-files.list.read-error', {
          appId,
          id,
          status,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        })
      }
      continue
    }
    if (!result.value.content) continue
    const parsed = parse(id, result.value.content)
    if (parsed) automations.push(parsed)
  }
  return automations
}

export async function create(appId: string, data: Omit<AutomationFile, 'id'>, id = generateId()): Promise<AutomationFile> {
  const appService = AppService.getInstance()
  const filePath = `${JOBS_DIR}/${id}/${id}.md`

  await appService.writeFile(appId, filePath, serialize(data))

  try {
    await withIndexLock(appId, async function updateIndex() {
      for (let attempt = 0; attempt < INDEX_MERGE_ATTEMPTS; attempt++) {
        const ids = await readIndex(appId)
        if (ids.includes(id)) return
        await writeIndex(appId, [...ids, id])
        // Re-read to detect a cross-tab write that clobbered ours. Without
        // server-side CAS the remaining TOCTOU window is very small in practice.
        if ((await readIndex(appId)).includes(id)) return
        if (attempt < INDEX_MERGE_ATTEMPTS - 1) {
          await new Promise<void>(r => setTimeout(r, 50 * 2 ** attempt))
        }
      }
      throw new Error('automation-files.index.create-conflict')
    })
  } catch (err) {
    // Tombstone the file so list() skips it on future reads (no delete API available).
    await appService.writeFile(appId, filePath, '').catch(() => {})
    throw err
  }

  return { ...data, id }
}

export async function update(appId: string, id: string, data: Omit<AutomationFile, 'id'>): Promise<AutomationFile> {
  const appService = AppService.getInstance()
  const filePath = `${JOBS_DIR}/${id}/${id}.md`

  await appService.writeFile(appId, filePath, serialize(data))
  return { ...data, id }
}

export async function remove(appId: string, id: string): Promise<void> {
  const appService = AppService.getInstance()
  await appService.writeFile(appId, `${JOBS_DIR}/${id}/${id}.md`, '')

  await withIndexLock(appId, async function updateIndex() {
    for (let attempt = 0; attempt < INDEX_MERGE_ATTEMPTS; attempt++) {
      const ids = await readIndex(appId)
      if (!ids.includes(id)) return
      await writeIndex(appId, ids.filter(i => i !== id))
      if (!(await readIndex(appId)).includes(id)) return
      if (attempt < INDEX_MERGE_ATTEMPTS - 1) {
        await new Promise<void>(r => setTimeout(r, 50 * 2 ** attempt))
      }
    }
    // All attempts exhausted. The tombstoned file ensures list() skips this
    // automation, so stale index entry is non-fatal.
    logger.warn('automation-files.index.remove-conflict', { appId, id })
  })
}
