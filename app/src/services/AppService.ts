import { isRestoreMetadata, type RestoreActionMetadata } from '@airo/shared/chat'

import { buildApiUrl } from '@/config/api'
import { buildDynamicAgentUrl, buildDynamicApiUrl } from '@/config/dynamic-api'
import { agentFetch } from '@/lib/agent-fetch'
import { appFetch } from '@/lib/gasket-config'
import { type AiroDeploymentStatus } from '@/lib/mgmt-airo'
import { logger } from '@/lib/request-context'
import { formatSubscriptionId } from '@/lib/subscription-id'
import { type AppStatusType } from '@/stores/useAppStore'
import { type ServerStatusType } from '@/stores/useServerStore'
import { useSiteStore } from '@/stores/useSiteStore'
import { TextEditErrorCode, type TextEditErrorCodeValue } from '@/utils/eventBus'

function stripShareToken(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const parsed = new URL(normalized)
    if (!parsed.searchParams.has('airoShareToken')) return url
    parsed.searchParams.delete('airoShareToken')
    if (!/^https?:\/\//i.test(url)) {
      return parsed.toString().replace(/^https:\/\//, '')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export interface App {
  id: string
  name: string
  port: number
  initialPrompt?: string
  status: AppStatusType
  initialBuildComplete?: boolean
  createdAt: string
  updatedAt: string
}

export interface GitCommit {
  hash: string
  message: string
  author: string
  date: string
}

/** Page size for `getGitHistory`; keep default in sync with agents `GIT_HISTORY_DEFAULT_COUNT` in `git.ts` routes. */
export const GIT_HISTORY_PAGE_SIZE = 30

/** HTTP status from `getGitHistory` failures (React Query may not keep non-standard `Error` fields). */
export function gitHistoryFailureHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const s = (error as { status: unknown }).status
    if (typeof s === 'number' && Number.isFinite(s)) {
      return s
    }
  }
  if (error instanceof Error) {
    const m = error.message.match(/Failed to load commit history:\s*(\d+)/)
    if (m?.[1]) {
      return parseInt(m[1], 10)
    }
  }
  return undefined
}

export interface GitHistoryResponse {
  commits: GitCommit[]
  currentCommit: string | null
  hasMore: boolean
}

/**
 * The persisted user-action notice row returned by `/git/restore`. Mirrors the
 * shape `useStreamingConversationStore.addCompletedMessage` expects so the
 * caller can drop it straight into the transcript without a re-fetch.
 */
export interface RestoreNotice {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  metadata: RestoreActionMetadata | null
}

function parseRestoreNotice(value: unknown): RestoreNotice | null {
  if (!value || typeof value !== 'object') return null
  const v = value as {
    id?: unknown
    sender?: unknown
    role?: unknown
    content?: unknown
    createdAt?: unknown
    metadata?: unknown
  }
  if (typeof v.id !== 'string' || typeof v.content !== 'string') return null
  // Server uses `sender`; tolerate either field name to keep the contract loose.
  const role = v.role === 'assistant' || v.sender === 'agent' ? 'assistant' : 'user'
  const createdAt = typeof v.createdAt === 'string'
    ? v.createdAt
    : v.createdAt instanceof Date
      ? v.createdAt.toISOString()
      : new Date().toISOString()
  const metadata = isRestoreMetadata(v.metadata) ? v.metadata : null
  return { id: v.id, role, content: v.content, createdAt, metadata }
}

export interface AppConfig {
  showUsageCost: boolean
}

export interface TextUpdateData {
  selector: string
  preciseSelector?: string
  oldText: string
  newText: string
  newHtml?: string
  devContext: Record<string, unknown>
}

export type TextUpdateResult =
  | { success: true; message?: string; data?: unknown }
  | { success?: false; error?: string; details?: string; code: TextEditErrorCodeValue }

export interface StyleUpdateData {
  selector: string
  property: string
  value: string
  newClassName: string
  elementInfo: {
    tagName: string
    className: string
    id: string
    dataId: string
    textContent: string
    selector: string
    devContext: Record<string, unknown>
    rect: { top: number; left: number; width: number; height: number }
    computedStyles: Record<string, string>
  }
}

export interface FormatOverrideTarget {
  file: string
  tagName: string
  sourceKind: 'bound-expression' | 'content-key' | 'content-key-template'
  contentKey?: string | null
  contentKeyTemplate?: string | null
  expressionHash?: string | null
}

export interface FormatOverrideUpdateData {
  commitId?: string
  devId: string
  target: FormatOverrideTarget
  marks: {
    bold?: boolean
    italic?: boolean
    color?: string | null
  }
}

export type FormatOverrideUpdateResult =
  | { success: true; commitHash?: string; removed?: boolean }
  | { success: false; error: string }

const FORMAT_OVERRIDE_UPDATE_FALLBACK_ERROR = 'Format override update failed'

function parseFormatOverrideUpdateResult(value: unknown): FormatOverrideUpdateResult {
  if (!value || typeof value !== 'object') {
    return { success: false, error: FORMAT_OVERRIDE_UPDATE_FALLBACK_ERROR }
  }

  const data = value as Record<string, unknown>
  if (data.success === true) {
    return {
      success: true,
      ...(typeof data.commitHash === 'string' ? { commitHash: data.commitHash } : {}),
      ...(typeof data.removed === 'boolean' ? { removed: data.removed } : {}),
    }
  }

  return {
    success: false,
    error: typeof data.error === 'string' && data.error
      ? data.error
      : FORMAT_OVERRIDE_UPDATE_FALLBACK_ERROR,
  }
}

export interface ElementDeleteResult {
  success: boolean
  message?: string
  data?: {
    filePath?: string
    changes?: { tagName?: string; componentName?: string }
    commitHash?: string
  }
  error?: string
  details?: string
}

export interface ElementDeletePayload {
  selector: string
  preciseSelector?: string
  isVideo: boolean
  elementInfo: {
    tagName: string
    className?: string
    id?: string
    dataId?: string
    selector: string
    devContext: {
      fileName: string
      componentName: string
      lineNumber: number
      devId?: string
    }
  }
}

export interface ImageReplaceData {
  elementInfo: {
    tagName: string
    className: string
    id: string
    selector: string
    devContext: {
      fileName: string
      componentName: string
      lineNumber: number
    }
  }
  imageInfo: {
    type: 'img' | 'background' | 'contains-img' | 'sibling-img'
    currentUrl: string | null
  }
  newImageUrl: string
}

export interface ImageReplaceResult {
  success: boolean
  message?: string
  error?: string
  fallbackRequired?: boolean
  data?: {
    filePath: string
    changes: {
      oldUrl: string | null
      newUrl: string
      imageType: string
    }
    commitHash?: string
  }
}

export interface CreateAppData {
  name: string
  initialPrompt: string
}

export interface AppStatusData {
  id: string
  status: AppStatusType
  name: string
  port?: number
  createdAt: string
  updatedAt: string
}


export interface DailyUsageInfo {
  percentage: number
  resetTime: string | null
  spend?: number
  maxBudget?: number
  budgetDuration?: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
  lastModified?: string
}

export interface ServerInfo {
  appId: string
  port: number
  url: string
  status?: ServerStatusType
  lastActivity?: string
}

export class AppService {
  private static instance: AppService

  public static getInstance(): AppService {
    if (!AppService.instance) {
      AppService.instance = new AppService()
    }
    return AppService.instance
  }

  /**
   * Safely parse JSON response, handling empty responses
   */
  private async safeJsonParse(response: Response, defaultValue: unknown = null): Promise<unknown> {
    const contentLength = response.headers.get('content-length')
    const contentType = response.headers.get('content-type')

    // If there's no content or it's not JSON, return default value
    if (contentLength === '0' || !contentType?.includes('application/json')) {
      return defaultValue
    }

    try {
      return await response.json()
    } catch (parseError) {
      logger.warn('app.config.parse-error', { message: 'Failed to parse JSON response, using default value', parseError: parseError instanceof Error ? parseError.message : 'Unknown error' });
      return defaultValue
    }
  }

  /**
   * Fetch app details by ID
   */
  async getApp(appId: string): Promise<{ app: App }> {
    const apiUrl = await buildDynamicApiUrl(``, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch app: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Fetch app configuration
   */
  async getConfig(siteId?: string): Promise<{ config: AppConfig }> {
    let url: string
    let response: Response

    if (siteId) {
      // Config is global, but we need to use the correct agent base URL
      const { dynamicApiConfigService } = await import('@/config/dynamic-api')
      const config = await dynamicApiConfigService.getConfigForSite(siteId)
      // Remove the app-specific path and use the base agent URL
      const baseAgentUrl = config.agentUrl.replace(`/apps/${siteId}`, '')
      url = `${baseAgentUrl}/apps/config`

      // Use agentFetch for agent API calls
      response = await agentFetch(url, { siteId })
    } else {
      url = buildApiUrl('apps/config')

      // Use appFetch for app backend API calls
      response = await appFetch(url)
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch config: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Restart app server
   */
  async restartApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`restart`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to restart server: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get git commit history for an app
   */
  async getGitHistory(appId: string, offset: number = 0): Promise<GitHistoryResponse> {
    const params = new URLSearchParams({
      offset: String(offset),
      count: String(GIT_HISTORY_PAGE_SIZE),
    })
    const apiUrl = await buildDynamicApiUrl(`git/history?${params}`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      const err = new Error(`Failed to load commit history: ${response.status}`) as Error & {
        status: number;
      };
      err.status = response.status;
      throw err;
    }

    const data = await response.json()

    // Ensure backward compatibility with agents that don't return currentCommit/hasMore.
    return {
      commits: data.commits || [],
      currentCommit: data.currentCommit ?? null,
      hasMore: data.hasMore ?? (data.commits || []).length >= GIT_HISTORY_PAGE_SIZE
    }
  }

  /**
   * Checkout a specific git commit.
   *
   * Returns:
   *  - `pageHint` — a route path for the page that received the largest diff
   *    in that commit (filename-derived), or `null` if the commit didn't
   *    touch any page or the response couldn't be parsed.
   *  - `modulePath` — the source file the hint was derived from (e.g.
   *    `src/pages/about.tsx`). Sent through to dev-tools so it can resolve
   *    via the live route registry when the filename heuristic misses
   *    (skill-installed pages can be mounted at non-filename paths).
   *
   * The develop UI uses these to navigate the preview iframe so it doesn't
   * land on the dev-tools 404 when the user's current path didn't exist yet
   * at that commit.
   */
  async checkoutCommit(
    appId: string,
    commitHash: string
  ): Promise<{ pageHint: string | null; modulePath: string | null }> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/checkout`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    })

    if (!response.ok) {
      throw new Error(`Failed to checkout commit: ${response.status}`)
    }

    const data = await response.json().catch((error: unknown) => {
      // The checkout itself succeeded (response.ok); only the body failed
      // to parse, so don't throw — degrade to "no hint" and let the iframe
      // sit on its current path. Logged so a malformed agents response
      // doesn't silently strip page-steering for every checkout.
      logger.warn('app-service.checkout-commit.parse-failed', {
        appId,
        commitHash: commitHash.substring(0, 7),
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }) as { pageHint?: unknown; modulePath?: unknown } | null
    const rawHint = data?.pageHint
    const rawModule = data?.modulePath
    return {
      pageHint: typeof rawHint === 'string' ? rawHint : null,
      modulePath: typeof rawModule === 'string' ? rawModule : null,
    }
  }

  /**
   * Return to main branch (latest version)
   */
  async returnToMainBranch(appId: string): Promise<void> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/return`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: 'main' })
    })

    if (!response.ok) {
      throw new Error(`Failed to return to latest version: ${response.status}`)
    }
  }

  /**
   * Unified rewind: stashes any uncommitted changes (always), then optionally
   * restores onto a target commit. The endpoint also persists a synthetic
   * user-action notice so the next agent turn sees the rollback; the saved
   * row is returned in `notice` so the caller can mirror it directly into
   * the local transcript store without a follow-up fetch.
   *
   * Diff text is fetched lazily by `UserActionDiffRenderer` via
   * `getUserActionDiff` when the user expands the card — it intentionally
   * does not ride on this response.
   *
   * Pass `commitHash` to rewind onto an older commit. Omit it (or pass the
   * current HEAD) to do a stash-only call — used by the chat undo button
   * mid-stream / on a dirty tree where there is no older commit to target.
   */
  async restoreCommit(appId: string, commitHash?: string): Promise<{
    success: boolean
    message?: string
    hasChanges: boolean
    stashHash: string | null
    notice: RestoreNotice | null
  }> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/restore`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitHash ? { commitHash } : {})
    })

    if (!response.ok) {
      throw new Error(`Failed to rewind working tree: ${response.status}`)
    }

    const data = await response.json()
    return {
      success: Boolean(data?.success),
      message: typeof data?.message === 'string' ? data.message : undefined,
      hasChanges: Boolean(data?.hasChanges),
      stashHash: typeof data?.stashHash === 'string' ? data.stashHash : null,
      notice: parseRestoreNotice(data?.notice),
    }
  }

  /**
   * Fetch the combined diff for a user-action notice. Pass whichever hashes
   * are present on the notice metadata (`commitHash`, `stashHash`, or both)
   * and the agents service returns a single concatenated unified diff —
   * stash content first (uncommitted-work side), then the commit's intrinsic
   * `commitHash^..commitHash` diff. Used by `UserActionDiffRenderer` to
   * render rolled-back changes inline in the transcript without bloating
   * the persisted message.
   */
  async getUserActionDiff(
    appId: string,
    args: { commitHash?: string; stashHash?: string }
  ): Promise<{ diff: string | null; diffTruncated: boolean }> {
    const params = new URLSearchParams()
    if (args.commitHash) params.set('commitHash', args.commitHash)
    if (args.stashHash) params.set('stashHash', args.stashHash)

    const apiUrl = await buildDynamicApiUrl(`git/diff?${params.toString()}`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to fetch user-action diff: ${response.status}`)
    }

    const data = await response.json()
    return {
      diff: typeof data?.diff === 'string' ? data.diff : null,
      diffTruncated: Boolean(data?.diffTruncated),
    }
  }


  /**
   * Edit the latest commit message on the main branch
   */
  async updateCommitMessage(appId: string, message: string, expectedHash?: string): Promise<{ success: boolean; newCommitHash: string }> {
    const apiUrl = await buildDynamicAgentUrl(`apps/${appId}/git/commit-message`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, expectedHash })
    })

    if (!response.ok) {
      let errorMessage = `Failed to update commit message: ${response.status}`
      try {
        const data = await response.json() as { error?: unknown }
        if (typeof data.error === 'string') {
          errorMessage = data.error
        }
      } catch {
        // Ignore JSON parsing errors and use the default message
      }
      throw new Error(errorMessage)
    }

    return response.json()
  }

  /**
   * Publish app by creating an archive and triggering deployment
   *
   * This method calls the app service's publish endpoint which:
   * 1. Creates a git archive via the agents service
   * 2. Notifies mgmt-airo to trigger deployment (if V2 site)
   *
   * @param {string} appId - The ID of the app to publish
   * @param {string} commitHash - The git commit hash to publish (can be short or full hash)
   * @returns {Promise<Object>} Response containing success status, commitHash, archive path, and optional deployment info
   * @throws {Error} If the publish operation fails
   *
   * @example
   * ```typescript
   * const result = await appService.publishApp('app-123', 'a1b2c3d4');
   * console.log('Archive created:', result.archive.path);
   * if (result.deployment) {
   *   console.log('Deployment ID:', result.deployment.deploymentId);
   * }
   * ```
   */
  async publishApp(appId: string, commitHash: string): Promise<{
    success: boolean;
    commitHash: string;
    archive: { path: string };
    deployment?: {
      deploymentId: string;
      statusJobId: string;
      status: AiroDeploymentStatus;
      message: string;
    }
  }> {
    const response = await appFetch(`/api/apps/${appId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitHash })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Failed to publish app: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Update element text content
   */
  async updateText(appId: string, textData: TextUpdateData): Promise<TextUpdateResult> {
    const requestBody = {
      selector: textData.selector,
      preciseSelector: textData.preciseSelector,
      oldText: textData.oldText,
      newText: textData.newText,
      newHtml: textData.newHtml,
      devContext: textData.devContext,
    };

    const apiUrl = await buildDynamicApiUrl(`text/edit`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      const body = await response.json().catch(() => null)
      if (
        response.status === 400 &&
        body &&
        typeof body === 'object' &&
        'code' in body &&
        body.code === TextEditErrorCode.UnsupportedDynamicTextContent
      ) return body as TextUpdateResult

      const error = body &&
        typeof body === 'object' &&
        'error' in body &&
        typeof body.error === 'string'
        ? `: ${body.error}`
        : ''
      throw new Error(`Failed to send text update to API: ${response.status}${error}`)
    }

    return response.json()
  }

  /**
   * Run a typo/grammar correction over the supplied text.
   *
   * Pure transformation — does not write to disk. The caller renders a diff
   * preview and, on user confirmation, sends the resulting text through the
   * existing `updateText` flow to commit.
   */
  async fixText(appId: string, payload: { oldText: string }): Promise<{ success: boolean; data: { newText: string; changed: boolean } }> {
    const apiUrl = await buildDynamicApiUrl(`text/fix`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      throw new Error(`Failed to fix text: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Update element style (class toggle for bold/italic)
   */
  async updateStyle(appId: string, styleData: StyleUpdateData): Promise<unknown> {
    const requestBody = {
      selector: styleData.selector,
      property: styleData.property,
      value: styleData.value,
      newClassName: styleData.newClassName,
      elementInfo: styleData.elementInfo,
    }

    const apiUrl = await buildDynamicApiUrl(`styles/edit`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to send style update to API: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Remove an image/video element from the page source via AST.
   */
  async deleteElement(appId: string, payload: ElementDeletePayload): Promise<ElementDeleteResult> {
    const requestBody = {
      selector: payload.selector,
      preciseSelector: payload.preciseSelector,
      isVideo: payload.isVideo,
      elementInfo: payload.elementInfo,
    }

    const apiUrl = await buildDynamicApiUrl(`elements/remove`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to remove element via API: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Persist bound-text format overrides through the agents sidecar route.
   */
  async updateFormatOverride(appId: string, data: FormatOverrideUpdateData): Promise<FormatOverrideUpdateResult> {
    const apiUrl = await buildDynamicApiUrl('format-overrides', appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        devId: data.devId,
        target: data.target,
        marks: data.marks,
      })
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { error?: unknown } | null
      const message = typeof errorBody?.error === 'string'
        ? errorBody.error
        : `Failed to send format override update to API: ${response.status}`
      throw new Error(message)
    }

    return parseFormatOverrideUpdateResult(await response.json())
  }

  /**
   * Replace image using AST-based approach
   * Returns success:true if AST replacement worked, or fallbackRequired:true if LLM should handle it
   */
  async replaceImage(appId: string, imageData: ImageReplaceData): Promise<ImageReplaceResult> {
    const requestBody = {
      elementInfo: imageData.elementInfo,
      imageInfo: imageData.imageInfo,
      newImageUrl: imageData.newImageUrl
    };

    const apiUrl = await buildDynamicApiUrl(`images/replace`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    // Parse response regardless of status
    const result = await response.json() as ImageReplaceResult

    // Even if response is not ok, check if it explicitly says fallback is required
    if (!response.ok) {
      logger.warn('app-service.replace-image.ast-failed', {
        appId,
        status: response.status,
        fallbackRequired: result.fallbackRequired
      })
      return {
        success: false,
        error: result.error || `AST replacement failed: ${response.status}`,
        fallbackRequired: result.fallbackRequired ?? true
      }
    }

    return result
  }

  /**
   * Create a new app
   */
  async createApp(appData: CreateAppData): Promise<Response> {
    return await appFetch(buildApiUrl('apps/create'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appData)
    });
  }

  /**
   * Get app status (for polling during creation)
   */
  async getAppStatus(appId: string): Promise<AppStatusData> {
    // appId is the same as siteId in our system
    const apiUrl = await buildDynamicApiUrl(`status`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to get app status: ${response.status}`)
    }

    return response.json()
  }


  /**
   * Get file tree for an app
   */
  async getFiles(appId: string, maxDepth: number = 5): Promise<{ entries: Array<{name: string; isDirectory: boolean; path: string; depth: number}> }> {
    const apiUrl = await buildDynamicApiUrl(`files?maxDepth=${maxDepth}`, appId)
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      throw new Error(`Failed to load files: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Read file content.
   *
   * `maxLines` raises the agents read route's line cap for whole-file reads
   * (e.g. JSON snapshots that must parse intact). Omitted → the dev-supervisor's
   * default cap applies, which is the right behavior for code previews. The
   * returned `truncated` lets callers detect a clipped read instead of silently
   * parsing a partial document.
   */
  async readFile(
    appId: string,
    filePath: string,
    options?: { maxLines?: number },
  ): Promise<{ content: string; truncated: boolean }> {
    const limitQuery = options?.maxLines ? `&limit=${options.maxLines}` : ''
    const apiUrl = await buildDynamicApiUrl(
      `files/read?path=${encodeURIComponent(filePath)}${limitQuery}`,
      appId,
    )
    const response = await agentFetch(apiUrl, { siteId: appId })

    if (!response.ok) {
      // Attach the HTTP status so callers can distinguish an expected 404
      // (file not written yet) from a real failure (500/network/auth).
      const error = new Error(`Failed to load file content: ${response.status}`) as Error & { status?: number }
      error.status = response.status
      throw error
    }

    const data = (await response.json()) as { content: string; truncated?: boolean }
    return { content: data.content, truncated: data.truncated ?? false }
  }

  /**
   * Write file content
   */
  async writeFile(appId: string, filePath: string, content: string, mode: string = 'rewrite'): Promise<{ success: boolean }> {
    const requestBody = { path: filePath, content, mode };
    const apiUrl = await buildDynamicApiUrl(`files/write`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      throw new Error(`Failed to save file: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Search code in app files
   */
  async searchCode(
    appId: string,
    query: string,
    options: {
      caseSensitive?: boolean
      regex?: boolean
      maxResults?: number
      filePattern?: string
      signal?: AbortSignal
    } = {}
  ): Promise<{
    matches: Array<{
      path: string
      line: number
      column: number
      text: string
      matchStart: number
      matchEnd: number
    }>
    totalMatches: number
    truncated: boolean
    error?: string
  }> {
    const requestBody = {
      query,
      caseSensitive: options.caseSensitive,
      regex: options.regex,
      maxResults: options.maxResults,
      filePattern: options.filePattern
    }

    const apiUrl = await buildDynamicApiUrl(`files/search`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal
    })

    if (!response.ok) {
      throw new Error(`Failed to search code: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get all apps
   */
  async getAllApps(): Promise<{ apps: App[] }> {
    const response = await appFetch(buildApiUrl('apps'))

    if (!response.ok) {
      throw new Error(`Failed to fetch apps: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Get running servers
   */
  async getServers(): Promise<{ servers: ServerInfo[] }> {
    // Call local API route instead of external service
    const response = await appFetch('/api/servers')

    if (!response.ok) {
      throw new Error(`Failed to fetch servers: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Stop an app
   */
  async stopApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(`stop`, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to stop app: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'App stopped successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Delete an app
   */
  async deleteApp(appId: string): Promise<{ success: boolean; message?: string }> {
    const apiUrl = await buildDynamicApiUrl(``, appId)
    const response = await agentFetch(apiUrl, {
      siteId: appId,
      method: 'DELETE'
    })

    if (!response.ok) {
      let errorMessage = `Failed to delete app: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
      } catch {
        // Unable to parse error response, use default message
      }
      throw new Error(errorMessage)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'App deleted successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Stop all running apps
   */
  async stopAllApps(): Promise<{ success: boolean; message?: string }> {
    const response = await appFetch(buildApiUrl('apps/stop-all'), {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to stop all apps: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'All apps stopped successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Cleanup orphaned apps
   */
  async cleanupOrphans(): Promise<{ success: boolean; message?: string }> {
    const response = await appFetch(buildApiUrl('apps/cleanup-orphans'), {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error(`Failed to cleanup orphaned apps: ${response.status}`)
    }

    return (await this.safeJsonParse(response, { success: true, message: 'Cleanup completed successfully' })) as { success: boolean; message?: string }
  }

  /**
   * Ensure an app is registered with the agent backend using the latest site metadata.
   *
   * @param appId - The identifier of the app that should exist in the agent repository.
   * @returns Promise that resolves to true when the registration call succeeds.
   * @example
   * ```ts
   * const registered = await appService.ensureAppRegistered('app-123')
   * ```
   */
  async ensureAppRegistered(appId: string): Promise<boolean> {
    try {
      logger.info('app-service.ensure-register.begin', {
        message: 'Ensuring app is registered with agent service',
        appId
      })

      const siteStore = useSiteStore.getState()
      let site = siteStore.sites?.[appId]
      if (!site) {
        site = await siteStore.fetchSite(appId, true)
      }

      if (!site) {
        logger.warn('app-service.ensure-register.no-site', {
          message: 'Site data unavailable, cannot register app',
          appId
        })
        return false
      }

      if (!site.agent_url) {
        logger.warn('app-service.ensure-register.no-agent-url', {
          message: 'Agent URL missing, skipping registration attempt',
          appId
        })
        return false
      }

      const prefixedSubscriptionId = formatSubscriptionId(site.subscription_id)
      const payload = {
        siteId: appId,
        name: site.name || `App ${appId}`,
        initialPrompt: site.initial_prompt,
        previewUrl: stripShareToken(site.preview_url),
        subscriptionId: prefixedSubscriptionId,
        customerId: site.account_id
      }

      const registerResponse = await agentFetch(`${site.agent_url}/apps/register`, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!registerResponse.ok) {
        logger.warn('app-service.ensure-register.failed', {
          message: 'Agent registration failed',
          status: registerResponse.status,
          appId
        })
        return false
      }

      logger.info('app-service.ensure-register.success', {
        message: 'App registered (or already registered) successfully',
        appId
      })
      return true
    } catch (error) {
      logger.error('app-service.ensure-register.error', {
        message: 'Unexpected error while registering app',
        appId,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /**
   * Register the app with the agent
   *
   * This function registers the app with the agent. The app name should be set
   * by the initial agent using the setProjectName tool before this is called.
   *
   * @param appId - The ID of the app to register
   * @returns Promise that resolves when registration is complete
   *
   * @throws {Error} If any of the API calls fail
   * @example
   * ```ts
   * await appService.updateNameAndRegister('app-123')
   * ```
   */
  async updateNameAndRegister(appId: string): Promise<void> {
    try {
      logger.info('develop-page.registration.start', {
        message: 'Starting app registration',
        appId
      })

      // Get fresh site data
      const siteStore = useSiteStore.getState()
      const freshSite = await siteStore.fetchSite(appId, true)

      if (!freshSite?.agent_url) {
        logger.warn('develop-page.registration.no-agent-url', {
          message: 'No agent URL available, skipping registration'
        })
        return
      }

      // Call register endpoint (name should already be set by initial agent)
      const prefixedSubscriptionId = formatSubscriptionId(freshSite.subscription_id);

      logger.info('develop-page.registration.registering', {
        message: 'Registering app',
        siteId: appId,
        name: freshSite.name,
        customerId: freshSite.account_id || 'not-provided',
        subscriptionId_original: freshSite.subscription_id || 'not-provided',
        subscriptionId_prefixed: prefixedSubscriptionId || 'not-provided'
      })

      const registerResponse = await agentFetch(`${freshSite.agent_url}/apps/register`, {
        siteId: appId,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: appId,
          name: freshSite.name,
          initialPrompt: freshSite.initial_prompt,
          previewUrl: stripShareToken(freshSite.preview_url),
          subscriptionId: prefixedSubscriptionId,
          customerId: freshSite.account_id
        })
      })

      if (registerResponse.ok) {
        logger.info('develop-page.registration.success', {
          message: 'App registered successfully',
          name: freshSite.name
        })
      } else {
        logger.warn('develop-page.registration.failed', {
          message: 'App registration failed',
          status: registerResponse.status
        })
      }

    } catch (error) {
      logger.error('develop-page.registration.error', {
        appId,
        message: 'Error during registration',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}

// Export a singleton instance for convenience
export const appService = AppService.getInstance()
