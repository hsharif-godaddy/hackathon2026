import { getDefaultGoCodeEndpoint, getDefaultAnthropicProxyEndpoint } from '@airo/ai-lib'

// Provider routing is by injected path prefix (`/u/<name>`) rather than
// wire-format sniffing: dev-runner points the agent's *_BASE_URL at the proxy
// with the prefix that names which agent base URL the traffic came from, and
// the proxy forwards the post-prefix path verbatim to the real upstream.
//
// The real upstream depends on the agent's auth mode, which the proxy learns by
// reading agents/.env (NOT by having that file rewritten — see AgentsEnv). In
// s2s mode every chat/embedding base URL collapses onto GoCode; in api-key mode
// the agent's own ANTHROPIC_BASE_URL / OPENAI_BASE_URL are the upstreams.
export type ProviderName = 'gocode' | 'anthropic' | 'openai'

// Snapshot of the agent's provider configuration, read once at proxy startup.
export interface AgentsEnv {
  s2s: boolean
  openaiBaseUrl?: string
  anthropicBaseUrl?: string
}

export interface ParsedTarget {
  provider: ProviderName
  // Upstream-relative path including query, e.g. '/v1/messages?beta=true'.
  path: string
}

export function isProviderName(value: string | undefined): value is ProviderName {
  return value === 'gocode' || value === 'anthropic' || value === 'openai'
}

// Splits '/u/<name>/rest...' into the provider and the post-prefix path.
// Returns null when the URL carries no recognized provider prefix.
export function parseProviderPrefix(rawUrl: string): ParsedTarget | null {
  const match: RegExpExecArray | null = /^\/u\/([^/?]+)(\/[^?]*)?(\?.*)?$/.exec(rawUrl)
  if (!match) {
    return null
  }
  const name: string | undefined = match[1]
  if (!isProviderName(name)) {
    return null
  }
  const rest: string = match[2] ?? '/'
  const query: string = match[3] ?? ''
  return { provider: name, path: rest + query }
}

export interface ResolveOptions {
  agentsEnv?: AgentsEnv
  // Origin of the proxy's own data listener (e.g. 'http://127.0.0.1:8788').
  // An agent-configured base URL pointing back at this origin is ignored to
  // avoid a forwarding loop.
  proxyOrigin?: string
}

export function resolveUpstream(provider: ProviderName, options: ResolveOptions = {}): string {
  const agents: AgentsEnv = options.agentsEnv ?? { s2s: true }
  const goCode: string = stripTrailingSlash(getDefaultGoCodeEndpoint())

  switch (provider) {
    case 'gocode':
      return goCode
    case 'openai':
      // In s2s mode OPENAI_BASE_URL drives both chat and embeddings to GoCode.
      if (agents.s2s) {
        return goCode
      }
      return guarded(agents.openaiBaseUrl, goCode, options.proxyOrigin)
    case 'anthropic':
      // Unused in s2s (the anthropic provider keys off the s2s GoCode base),
      // but mapping it to GoCode keeps the proxy correct either way.
      if (agents.s2s) {
        return goCode
      }
      return guarded(agents.anthropicBaseUrl, stripTrailingSlash(getDefaultAnthropicProxyEndpoint()), options.proxyOrigin)
  }
}

// Returns the agent-configured upstream unless it is empty or loops back at the
// proxy, in which case the ai-lib default is used.
function guarded(configured: string | undefined, fallback: string, proxyOrigin: string | undefined): string {
  if (!configured || isSelfReference(configured, proxyOrigin)) {
    return fallback
  }
  return stripTrailingSlash(configured)
}

function isSelfReference(url: string, proxyOrigin: string | undefined): boolean {
  if (!proxyOrigin) {
    return false
  }
  try {
    return new URL(url).host === new URL(proxyOrigin).host
  } catch {
    return false
  }
}

export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}
