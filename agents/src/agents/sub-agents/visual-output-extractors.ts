import type { VisualOutput } from '../sub-agent-runner.js'

export function mediaExtractor(toolName: string, _args: unknown, result: unknown): VisualOutput | null {
  if (toolName !== 'media') return null
  let r: { slot?: string; slotUrl?: string; resolvedUrl?: string; success?: boolean } | null = null
  if (typeof result === 'string') {
    try { r = JSON.parse(result) } catch { return null }
  } else {
    r = result as typeof r
  }
  if (!r?.success || !r.slot) return null
  return { type: 'media', label: r.slot, url: r.slotUrl, thumbnailUrl: r.resolvedUrl }
}

export function pageExtractor(toolName: string, args: unknown, _result: unknown): VisualOutput | null {
  if (toolName !== 'str_replace_based_edit_tool') return null
  const a = args as { command?: string; path?: string } | null
  if (!a?.path) return null
  const match = a.path.match(/^src\/pages\/(.+)\.tsx$/)
  if (!match?.[1]) return null
  const name = match[1]
  const route = name.toLowerCase() === 'home' ? '/' : '/' + name.toLowerCase()
  return { type: 'page', label: route, url: route }
}

export function docExtractor(toolName: string, args: unknown, _result: unknown): VisualOutput | null {
  if (toolName !== 'showDoc') return null
  const a = args as { path?: string } | null
  if (!a?.path) return null
  return { type: 'doc', label: a.path, url: a.path }
}
