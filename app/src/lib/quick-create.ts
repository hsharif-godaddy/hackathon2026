import { appFetch, type AppFetchOptions } from '@/lib/gasket-config'
import { getItcOverride } from '@/lib/itc'

export interface QuickCreateResponse {
  id: string
  name?: string
  status: string
  account_id: string
  created_at?: string
  updated_at?: string
  type: 'job' | 'site'
}

interface FetchQuickCreateOptions {
  productId?: string
  fqdn?: string
}

export async function fetchQuickCreate(prompt: string, fetchOptions?: AppFetchOptions, options?: FetchQuickCreateOptions) {
  return appFetch('/api/sites/quick-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initialPrompt: prompt,
      itc: getItcOverride() ?? undefined,
      ...(options?.productId && { productId: options.productId }),
      ...(options?.fqdn && { fqdn: options.fqdn }),
    }),
  }, fetchOptions)
}

interface ApiErrorData {
  message?: string
  error?: string
  details?: string
  errorCode?: string
}

export function extractApiError(errorData: ApiErrorData): Error {
  const error = new Error(errorData.message || errorData.error || 'Failed to create site')
  if (errorData.details) {
    Object.assign(error, { details: errorData.details })
  }
  if (errorData.errorCode) {
    Object.assign(error, { errorCode: errorData.errorCode })
  }
  return error
}

export interface QuickCreateSessionOptions {
  uploadedFiles?: Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean; zipRaw?: ArrayBuffer }>
  entryPoint?: string
  creationSource?: string
  /** Defaults to 'new_build'. Pass a different value for non-standard creation flows (e.g. app import). */
  intentCategory?: string
}

export function setQuickCreateSessionFlags(
  siteId: string,
  prompt: string,
  templateId?: string,
  options: QuickCreateSessionOptions = {},
) {
  const { uploadedFiles, entryPoint, creationSource, intentCategory = 'new_build' } = options
  sessionStorage.setItem(`name-registration-pending-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-pending-${siteId}`, 'true')
  sessionStorage.setItem(`in-creation-flow-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-text-${siteId}`, prompt)
  if (templateId && templateId !== 'default') {
    sessionStorage.setItem(`initial-template-${siteId}`, templateId)
  }
  if (uploadedFiles && uploadedFiles.length > 0) {
    const serializable = uploadedFiles.map(({ zipRaw: _, ...rest }) => rest)
    sessionStorage.setItem(`initial-upload-files-${siteId}`, JSON.stringify(serializable))
  }
  if (entryPoint) {
    sessionStorage.setItem(`entry-point-${siteId}`, entryPoint)
  }
  if (creationSource) {
    sessionStorage.setItem(`creation-source-${siteId}`, creationSource)
  }
  sessionStorage.setItem(`intent-category-${siteId}`, intentCategory)
}

export function getStoredUploadedFiles(
  initialJobId: string | null | undefined,
  appId: string | null | undefined,
): Array<{ name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; isImage?: boolean }> {
  const keysToTry = [initialJobId, appId].filter(Boolean) as string[]
  for (const key of keysToTry) {
    const pluralRaw = sessionStorage.getItem(`initial-upload-files-${key}`)
    if (pluralRaw) {
      try { return JSON.parse(pluralRaw) } catch { /* fall through */ }
    }
    const singularRaw = sessionStorage.getItem(`initial-upload-file-${key}`)
    if (singularRaw) {
      try { return [JSON.parse(singularRaw)] } catch { /* fall through */ }
    }
  }
  return []
}

const UPLOAD_DB_NAME = 'airo-file-uploads'
const UPLOAD_STORE = 'files'

function openUploadDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(UPLOAD_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(UPLOAD_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface StoredFileEntry {
  raw: ArrayBuffer
  fileName: string
  isDesignMd: boolean
  isZip?: boolean
  isUiKit?: boolean
  isAppImport?: boolean
  isImage?: boolean
}

export async function storeUploadedFiles(siteId: string, files: StoredFileEntry[]): Promise<void> {
  if (files.length === 0) return
  const db = await openUploadDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STORE, 'readwrite')
    tx.objectStore(UPLOAD_STORE).put({ files }, siteId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

function sortByUploadPriority(files: StoredFileEntry[]): StoredFileEntry[] {
  const priority = (f: StoredFileEntry): number => {
    if (f.isUiKit) return 0
    if (f.isAppImport) return 1
    if (f.isZip) return 2
    if (f.isImage) return 3
    return 4
  }
  return [...files].sort((a, b) => priority(a) - priority(b))
}

export async function retrieveAndUploadFiles(
  siteId: string,
  jobId?: string | null,
  expectedFileNames: string[] = [],
): Promise<{ uploaded: StoredFileEntry[]; failed: string[] }> {
  let db: IDBDatabase
  try {
    db = await openUploadDb()
  } catch {
    // DB unavailable — report the expected files as failed so the caller can
    // notify the user instead of silently sending the prompt with no context.
    return { uploaded: [], failed: expectedFileNames }
  }

  try {
    const keysToTry = [jobId, siteId].filter(Boolean) as string[]
    let entries: StoredFileEntry[] = []
    let matchedKey: string | undefined

    for (const key of keysToTry) {
      const result = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE, 'readonly')
        const req = tx.objectStore(UPLOAD_STORE).get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (result) {
        if ((result as { files?: unknown }).files) {
          entries = (result as { files: StoredFileEntry[] }).files
        } else if ((result as { raw?: unknown }).raw) {
          const legacy = result as { raw: ArrayBuffer; fileName: string }
          entries = [{ raw: legacy.raw, fileName: legacy.fileName, isDesignMd: false }]
        }
        matchedKey = key
        break
      }
    }

    if (entries.length === 0 || !matchedKey) {
      return { uploaded: [], failed: [] }
    }

    const { agentFetch } = await import('@/lib/agent-fetch')
    const { buildDynamicApiUrl } = await import('@/config/dynamic-api')

    const sorted = sortByUploadPriority(entries)
    const uploaded: StoredFileEntry[] = []
    const failed: string[] = []

    const mimeMap: Record<string, string> = {
      '.zip': 'application/zip',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }

    async function uploadOne(entry: StoredFileEntry): Promise<boolean> {
      const ext = entry.fileName.substring(entry.fileName.lastIndexOf('.')).toLowerCase()
      const mimeType = mimeMap[ext] || 'text/plain'
      const maxAttempts = 3
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const url = await buildDynamicApiUrl('file-upload', siteId)
          const formData = new FormData()
          formData.append('file', new Blob([entry.raw], { type: mimeType }), entry.fileName)
          const res = await agentFetch(url, { method: 'POST', body: formData, siteId })
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }))
            throw new Error(err.error || 'Failed to upload file')
          }
          return true
        } catch (err) {
          if (attempt === maxAttempts) return false
          await new Promise(r => setTimeout(r, 2000 * attempt))
        }
      }
      return false
    }

    const zips = sorted.filter(f => f.isZip || f.isUiKit || f.isAppImport)
    const rest = sorted.filter(f => !f.isZip && !f.isUiKit && !f.isAppImport)

    for (const entry of zips) {
      if (await uploadOne(entry)) {
        uploaded.push(entry)
      } else {
        failed.push(entry.fileName)
      }
    }

    await Promise.allSettled(rest.map(async (entry) => {
      if (await uploadOne(entry)) {
        uploaded.push(entry)
      } else {
        failed.push(entry.fileName)
      }
    }))

    // Only clear the IndexedDB record once every file uploaded successfully.
    // On partial or total failure, leave it in place so a later
    // retrieveAndUploadFiles call can retry — the serialized sessionStorage
    // record strips zipRaw, so IDB is the only source of the binary content.
    if (failed.length === 0) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(UPLOAD_STORE, 'readwrite')
        tx.objectStore(UPLOAD_STORE).delete(matchedKey!)
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
    }

    return { uploaded, failed }
  } finally {
    db.close()
  }
}

export function buildDevelopUrl(siteId: string, siteType: string): string {
  return siteType === 'job' ? `/develop/${siteId}?type=job` : `/develop/${siteId}`
}
