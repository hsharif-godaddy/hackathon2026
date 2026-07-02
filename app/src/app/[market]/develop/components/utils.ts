import { useParams } from "next/navigation"
import { RefObject } from "react"

import { logger } from '@/lib/request-context'
import type { ChatMessage, StreamingMessage, ToolCall } from '@/stores/useStreamingConversationStore'
import { postMessageToIframe } from '@/utils/postMessage'

/**
 * Serializes tool arguments to a string format for consistent display in components.
 * Handles both string and object types, converting objects to formatted JSON.
 *
 * @param toolArgs - Tool arguments that can be string, object, or undefined
 * @returns Serialized string or undefined if input is undefined
 */
export function serializeToolArgs(toolArgs: string | object | undefined): string | undefined {
  if (toolArgs === undefined || toolArgs === null) {
    return undefined
  }

  if (typeof toolArgs === 'string') {
    return toolArgs
  }

  if (typeof toolArgs === 'object') {
    return JSON.stringify(toolArgs)
  }

  // For any other type, convert to string
  return String(toolArgs)
}

/**
 * Get the render type for tool output display
 * Determines if tool output should be rendered as plain text (preserving formatting)
 * or as markdown (with rich formatting)
 *
 * @param toolName - The name of the tool
 * @returns 'plain' for tools that need preserved formatting (e.g., directory trees), 'markdown' otherwise
 */
export function getToolRenderType(toolName: string): 'plain' | 'markdown' {
  const plainTextTools = [
    'directoryListing',
    'directory_listing',
    // Add other tools that need plain text rendering here:
    // 'terminalCommand',
    // 'terminal_command',
    // 'grepSearch',
    // 'grep_search',
  ];
  return plainTextTools.includes(toolName) ? 'plain' : 'markdown';
}

export function useAppIdFromParams() {
  const params = useParams();
  const raw = params?.id;
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === 'string' && id.length > 0 ? id : '';
}

const VISUAL_CONTEXT_TIMEOUT_MS = 100

export function handlePreviewRefresh({ lastIframeState }: { lastIframeState: RefObject<any> }) {
  const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement

  if (!iframe || !iframe.contentWindow) {
    window.postMessage({
      type: 'preview-refresh',
      preserveState: lastIframeState.current
    }, window.location.origin)
    return
  }

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    window.removeEventListener('message', handleVisualContext)
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
  }

  const triggerRefresh = () => {
    window.postMessage({
      type: 'preview-refresh',
      preserveState: lastIframeState.current
    }, window.location.origin)
  }

  const handleVisualContext = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return
    if (event.data?.type !== 'VISUAL_CONTEXT_RESPONSE') return

    if (event.data.context?.scroll_position) {
      lastIframeState.current.scrollPosition = event.data.context.scroll_position
    }
    if (event.data.context?.page) {
      lastIframeState.current.url = event.data.context.page
    }

    cleanup()
    triggerRefresh()
  }

  const scheduleFallback = () => {
    // Keep a real-time fallback: rAF can be paused/throttled in background tabs,
    // which would delay refresh indefinitely.
    fallbackTimer = setTimeout(() => {
      cleanup()
      triggerRefresh()
    }, VISUAL_CONTEXT_TIMEOUT_MS)
  }

  window.addEventListener('message', handleVisualContext)
  scheduleFallback()

  try {
    postMessageToIframe(iframe, { type: 'REQUEST_VISUAL_CONTEXT' })
    postMessageToIframe(iframe, { type: 'REQUEST_SCREENSHOT' })
  } catch (error) {
    logger.error('develop.screenshot.request.failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    cleanup()
    triggerRefresh()
  }
}

/**
 * Navigates the preview iframe to a route without a full reload.
 * Uses RESTORE_STATE_AFTER_REFRESH + pushState inside the iframe so the
 * browser doesn't flash the home page before landing on the target route.
 * Vite HMR has already processed the new file by the time this runs.
 */
export function navigatePreviewToRoute(route: string) {
  const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
  if (!iframe?.contentWindow) return
  try {
    postMessageToIframe(iframe, {
      type: 'RESTORE_STATE_AFTER_REFRESH',
      url: route,
      scrollPosition: { x: 0, y: 0 }
    })
  } catch (error) {
    logger.error('develop.preview-navigate.failed', {
      route,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Requests a screenshot from the preview iframe for AI visual context.
 * This is a fire-and-forget operation — the screenshot response is handled
 * by the SCREENSHOT_RESPONSE message handler in page.tsx.
 */
export function requestPreviewScreenshot() {
  const iframe = document.querySelector('#preview-iframe') as HTMLIFrameElement
  if (!iframe || !iframe.contentWindow) return
  try {
    postMessageToIframe(iframe, { type: 'REQUEST_SCREENSHOT' })
  } catch (error) {
    logger.error('develop.screenshot.request.failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Checks if a message is a StreamingMessage (active, incomplete message)
 *
 * @param message - Message to check
 * @returns True if message has isComplete property (StreamingMessage), false otherwise (ChatMessage)
 */
export function isStreamingMessage(message: ChatMessage | StreamingMessage): message is StreamingMessage {
  return 'isComplete' in message
}

/**
 * Checks if a message has valid segments for rendering
 *
 * @param message - Message to check
 * @returns True if message has non-empty segments array, false otherwise
 */
export function hasValidSegments(message: ChatMessage | StreamingMessage): boolean {
  return Boolean(message.segments && message.segments.length > 0)
}

/**
 * Extracts tool calls from a message
 *
 * @param message - Message to extract tool calls from
 * @returns Array of tool calls, or empty array if none exist
 */
export function getToolCallsFromMessage(message: ChatMessage | StreamingMessage): ToolCall[] {
  return message.toolCalls || []
}

// Matches page files directly inside src/pages/ (not subdirectories).
// The (?:^|\/) prefix handles both relative paths (src/pages/...) and
// absolute paths (/workspace/app/src/pages/...) without matching deeper paths
// like src/pages/components/Button.tsx (which contain a second slash after pages/).
// Agents run on Linux so paths always use forward slashes.
const PAGE_FILE_PATTERN = /(?:^|\/)src\/pages\/([^/]+)\.(tsx|jsx|ts|js)$/

const EXCLUDED_PAGE_NAMES = new Set(['index', '404', '_404', '_error'])

/**
 * Extracts the route for a newly created page from the tool calls of a completed message.
 * Only considers page file creations (not modifications) in src/pages/.
 *
 * Returns the last created page's route, or null if no new pages were created.
 * Skips index, 404, error pages, and dynamic routes (e.g. [id].tsx).
 *
 * @example
 * // Agent created src/pages/about.tsx → returns '/about'
 * extractNewPageRoute([
 *   { name: 'textEditor', input: { command: 'create', path: 'src/pages/about.tsx' }, status: 'completed', ... }
 * ])
 *
 * // Agent only edited existing files → returns null
 * extractNewPageRoute([
 *   { name: 'textEditor', input: { command: 'str_replace', path: 'src/pages/index.tsx' }, status: 'completed', ... }
 * ])
 */
export function extractNewPageRoute(toolCalls: ToolCall[]): string | null {
  let lastRoute: string | null = null

  for (const tc of toolCalls) {
    if (tc.status !== 'completed' || tc.error) continue

    for (const pagePath of extractCreatedPagePaths(tc)) {
      // If the agent created src/pages/index.tsx in this batch, suppress
      // per-page navigation so the caller falls back to a full preview
      // refresh (which lands on /). Otherwise we would navigate to a
      // sibling placeholder page instead of the new home.
      if (isIndexPagePath(pagePath)) return null
      const route = pagePathToRoute(pagePath)
      if (route) lastRoute = route
    }
  }

  return lastRoute
}

function isIndexPagePath(filePath: string): boolean {
  const match = filePath.match(PAGE_FILE_PATTERN)
  return match?.[1].toLowerCase() === 'index'
}

function extractCreatedPagePaths(tc: ToolCall): string[] {
  const input = tc.input
  if (!input) return []

  switch (tc.name) {
    case 'str_replace_based_edit_tool':
    case 'textEditor': {
      if (input.command !== 'create') return []
      const path = input.path
      return typeof path === 'string' && isPageFile(path) ? [path] : []
    }

    case 'create_file':
    case 'write_file': {
      const path = input.path ?? input.file_path
      return typeof path === 'string' && isPageFile(path) ? [path] : []
    }

    case 'fileEdit': {
      if (!Array.isArray(input.operations)) return []
      return (input.operations as Array<Record<string, unknown>>)
        .filter((op): op is Record<string, unknown> & { path: string } =>
          op.type === 'create' && typeof op.path === 'string' && isPageFile(op.path)
        )
        .map(op => op.path)
    }

    default:
      return []
  }
}

function isPageFile(filePath: string): boolean {
  return PAGE_FILE_PATTERN.test(filePath)
}

function pagePathToRoute(filePath: string): string | null {
  const match = filePath.match(PAGE_FILE_PATTERN)
  if (!match) return null

  const fileName = match[1].toLowerCase()

  if (EXCLUDED_PAGE_NAMES.has(fileName)) return null
  if (fileName.includes('[') || fileName.includes(']')) return null

  return '/' + fileName
}

const MIN_SUBSTANTIVE_PAGE_CONTENT_CHARS = 100

function pagePathToRebuildSlug(filePath: string): string | null {
  const match = filePath.match(PAGE_FILE_PATTERN)
  if (!match) return null

  const fileName = match[1].toLowerCase()
  if (fileName === 'index') return 'homepage'
  if (EXCLUDED_PAGE_NAMES.has(fileName)) return null
  if (fileName.includes('[') || fileName.includes(']')) return null

  return fileName
}

function extractSubstantivePagePathsFromToolCall(tc: ToolCall): string[] {
  const input = tc.input
  if (!input) return []

  switch (tc.name) {
    case 'str_replace_based_edit_tool':
    case 'textEditor': {
      const path = input.path
      if (typeof path !== 'string' || !isPageFile(path)) return []
      if (input.command === 'create') {
        return extractSubstantivePageContentLength(input) >= MIN_SUBSTANTIVE_PAGE_CONTENT_CHARS ? [path] : []
      }
      return []
    }

    case 'create_file':
    case 'write_file': {
      const path = input.path ?? input.file_path
      if (typeof path !== 'string' || !isPageFile(path)) return []
      return extractSubstantivePageContentLength(input) >= MIN_SUBSTANTIVE_PAGE_CONTENT_CHARS ? [path] : []
    }

    case 'fileEdit': {
      if (!Array.isArray(input.operations)) return []
      return (input.operations as Array<Record<string, unknown>>)
        .filter((op): op is Record<string, unknown> & { path: string } => {
          if (typeof op.path !== 'string' || !isPageFile(op.path)) return false
          const mode = op.type ?? op.mode
          if (mode !== 'create') return false
          return extractSubstantivePageContentLength(op) >= MIN_SUBSTANTIVE_PAGE_CONTENT_CHARS
        })
        .map(op => op.path)
    }

    default:
      return []
  }
}

function extractSubstantivePageContentLength(input: Record<string, unknown>): number {
  for (const key of ['file_text', 'new_str', 'new_string', 'content']) {
    const value = input[key]
    if (typeof value === 'string') return value.length
  }
  return 0
}

/**
 * Rebuild slugs the develop agent substantively implemented in a completed turn.
 * Ignores blank route shells (small create payloads) so the upfront build queue
 * can still dispatch source-based prompts afterward.
 */
export function extractDevelopBuiltSlugsFromToolCalls(toolCalls: ToolCall[]): string[] {
  const slugs = new Set<string>()

  for (const tc of toolCalls) {
    if (tc.status !== 'completed' || tc.error) continue
    for (const pagePath of extractSubstantivePagePathsFromToolCall(tc)) {
      const slug = pagePathToRebuildSlug(pagePath)
      if (slug) slugs.add(slug)
    }
  }

  return [...slugs]
}

/**
 * Artifact kinds a single assistant turn can produce. Mirrors the JTBD
 * feedback tracks (`lib/initial-build-reveal.ts`) plus an explicit `brand`
 * track for brand-book / color / font generation.
 */
export type GeneratedArtifactType = 'logo' | 'website' | 'brand' | 'domain'

/**
 * Single-artifact precedence when one turn touches more than one track
 * (e.g. the initial build emits logo + brand together). The most specific,
 * user-recognizable artifact wins; `website` is the page-edit catch-all and is
 * resolved separately as the fallback below.
 */
const ARTIFACT_TYPE_PRECEDENCE: readonly GeneratedArtifactType[] = ['domain', 'logo', 'brand']

/** Bare (un-prefixed) AI-logo generation tool names. */
const LOGO_TOOL_NAMES: ReadonlySet<string> = new Set([
  'generate_logo',
  'edit_logo',
  'logoCompletionSuggestions',
])

/** Bare brand-identity generation tool names. */
const BRAND_TOOL_NAMES: ReadonlySet<string> = new Set([
  'brandBook',
  'brand',
  'colorScheme',
  'fontTheme',
  'cssColor',
])

/** Skill prefix whose tools all operate on the domain artifact track. */
const DOMAIN_TOOL_NAME_PREFIX: string = 'custom-domain__'

/**
 * Strips the `{skill}__` wire prefix from a tool name. Skill tools arrive as
 * e.g. `media-logo__generate_logo`; base tools have no prefix. The persisted
 * `ToolCall` carries no `skillName`, so the prefix is the only skill signal.
 */
function bareToolName(toolName: string): string {
  const separatorIndex: number = toolName.lastIndexOf('__')
  return separatorIndex >= 0 ? toolName.slice(separatorIndex + 2) : toolName
}

/** Maps one tool name to its artifact track, or null if it generates none. */
function artifactTypeForToolName(toolName: string): GeneratedArtifactType | null {
  if (toolName.startsWith(DOMAIN_TOOL_NAME_PREFIX)) return 'domain'
  const bare: string = bareToolName(toolName)
  if (LOGO_TOOL_NAMES.has(bare)) return 'logo'
  if (BRAND_TOOL_NAMES.has(bare)) return 'brand'
  return null
}

/** A classified artifact plus a best-effort instance id for tracing. */
export interface ClassifiedArtifact {
  type: GeneratedArtifactType
  /**
   * Specific instance identifier so a thumbs-down can be traced to the exact
   * artifact: logo → `logoId` (UUID), domain → FQDN, brand → palette/theme
   * name, website → the new page route. Null when the producing tool exposed
   * no identifier (callers can fall back to the turn's commit hash).
   */
  id: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Pulls the instance id for a logo/brand/domain tool call from its result
 * (preferred) or input. Field shapes mirror the agent tool returns:
 * `media-logo__*` → `structuredContent.{logoId,jobId,sessionId}`,
 * `custom-domain__domainPurchase` → `widgetData.domain` / input `domain`,
 * brand tools → `paletteName` / `themeName` / `themeId`.
 */
function extractArtifactId(tc: ToolCall, type: GeneratedArtifactType): string | null {
  const result: Record<string, unknown> | null = asRecord(tc.result)
  const input: Record<string, unknown> | null = asRecord(tc.input)

  if (type === 'logo') {
    const structured: Record<string, unknown> | null = asRecord(result?.structuredContent) ?? result
    return (
      asNonEmptyString(structured?.logoId) ??
      asNonEmptyString(structured?.jobId) ??
      asNonEmptyString(structured?.sessionId)
    )
  }

  if (type === 'domain') {
    const widgetData: Record<string, unknown> | null = asRecord(result?.widgetData)
    return asNonEmptyString(widgetData?.domain) ?? asNonEmptyString(input?.domain)
  }

  if (type === 'brand') {
    return (
      asNonEmptyString(result?.paletteName) ??
      asNonEmptyString(result?.themeName) ??
      asNonEmptyString(result?.themeId) ??
      asNonEmptyString(asRecord(result?.appliedFont)?.name)
    )
  }

  return null
}

/**
 * Infers which artifact a completed assistant turn produced from its tool
 * calls, plus a best-effort instance id. Only completed, error-free calls
 * count — an attempted-but-failed generation is not an artifact. Returns null
 * when the turn produced no recognizable artifact; that null is the trigger
 * gate for artifact-type feedback (no artifact → no feedback prompt).
 *
 * Website detection reuses `extractDevelopBuiltSlugsFromToolCalls` (substantive
 * page creates) so a turn that only edits prose or config is not treated as a
 * website artifact; its id is the new page route.
 */
export function classifyGeneratedArtifact(toolCalls: ToolCall[]): ClassifiedArtifact | null {
  const firstByType = new Map<GeneratedArtifactType, ToolCall>()
  const firstWithIdByType = new Map<GeneratedArtifactType, ToolCall>()

  for (const tc of toolCalls) {
    if (tc.status !== 'completed' || tc.error) continue
    const type: GeneratedArtifactType | null = artifactTypeForToolName(tc.name)
    if (!type) continue
    if (!firstByType.has(type)) firstByType.set(type, tc)
    if (!firstWithIdByType.has(type) && extractArtifactId(tc, type) !== null) {
      firstWithIdByType.set(type, tc)
    }
  }

  for (const type of ARTIFACT_TYPE_PRECEDENCE) {
    const tc = firstWithIdByType.get(type) ?? firstByType.get(type)
    if (tc) return { type, id: extractArtifactId(tc, type) }
  }

  const slugs: string[] = extractDevelopBuiltSlugsFromToolCalls(toolCalls)
  if (slugs.length > 0) {
    const route = extractNewPageRoute(toolCalls)
    const fallbackId = slugs[0] === 'homepage' ? '/' : `/${slugs[0]}`
    return { type: 'website', id: route ?? fallbackId }
  }

  return null
}

/** Type-only convenience wrapper over {@link classifyGeneratedArtifact}. */
export function classifyArtifactFromToolCalls(
  toolCalls: ToolCall[]
): GeneratedArtifactType | null {
  return classifyGeneratedArtifact(toolCalls)?.type ?? null
}
