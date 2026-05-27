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

export function setQuickCreateSessionFlags(
  siteId: string,
  prompt: string,
  templateId?: string,
  uploadedFile?: { name: string; content: string; isDesignMd: boolean; isZip?: boolean; isUiKit?: boolean; isAppImport?: boolean; zipFiles?: Array<{ path: string; content: string }> } | null,
) {
  sessionStorage.setItem(`name-registration-pending-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-pending-${siteId}`, 'true')
  sessionStorage.setItem(`in-creation-flow-${siteId}`, 'true')
  sessionStorage.setItem(`initial-prompt-text-${siteId}`, prompt)
  if (templateId && templateId !== 'default') {
    sessionStorage.setItem(`initial-template-${siteId}`, templateId)
  }
  if (uploadedFile) {
    // Don't serialize zipRaw (ArrayBuffer) — it's uploaded separately
    const { zipRaw: _, ...serializable } = uploadedFile as Record<string, unknown>
    sessionStorage.setItem(`initial-upload-file-${siteId}`, JSON.stringify(serializable))
  }
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

export async function storeUploadedFile(siteId: string, raw: ArrayBuffer, fileName: string): Promise<void> {
  const db = await openUploadDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(UPLOAD_STORE, 'readwrite')
    tx.objectStore(UPLOAD_STORE).put({ raw, fileName }, siteId)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function retrieveAndUploadFile(siteId: string, jobId?: string | null): Promise<boolean> {
  let db: IDBDatabase
  try {
    db = await openUploadDb()
  } catch {
    return false
  }

  try {
    const keysToTry = [jobId, siteId].filter(Boolean) as string[]
    let data: { raw: ArrayBuffer; fileName: string } | undefined
    let matchedKey: string | undefined

    for (const key of keysToTry) {
      const result = await new Promise<{ raw: ArrayBuffer; fileName: string } | undefined>((resolve, reject) => {
        const tx = db.transaction(UPLOAD_STORE, 'readonly')
        const req = tx.objectStore(UPLOAD_STORE).get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (result) {
        data = result
        matchedKey = key
        break
      }
    }

    if (!data || !matchedKey) {
      return false
    }

    const { agentFetch } = await import('@/lib/agent-fetch')
    const { buildDynamicApiUrl } = await import('@/config/dynamic-api')

    const ext = data.fileName.substring(data.fileName.lastIndexOf('.')).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.zip': 'application/zip',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
    }
    const mimeType = mimeMap[ext] || 'text/plain'
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const url = await buildDynamicApiUrl('file-upload', siteId)
        const formData = new FormData()
        formData.append('file', new Blob([data.raw], { type: mimeType }), data.fileName)
        const res = await agentFetch(url, { method: 'POST', body: formData, siteId })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Upload failed' }))
          throw new Error(err.error || 'Failed to upload file')
        }

        // Delete from IndexedDB only after successful upload
        await new Promise<void>((resolve) => {
          const tx = db.transaction(UPLOAD_STORE, 'readwrite')
          tx.objectStore(UPLOAD_STORE).delete(matchedKey!)
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
        })
        return true
      } catch (err) {
        if (attempt === maxAttempts) throw err
        await new Promise(r => setTimeout(r, 2000 * attempt))
      }
    }
    return false
  } finally {
    db.close()
  }
}

export function buildDevelopUrl(siteId: string, siteType: string): string {
  return siteType === 'job' ? `/develop/${siteId}?type=job` : `/develop/${siteId}`
}
