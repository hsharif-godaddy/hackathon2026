/**
 * Shared tool-frame metadata resolution.
 *
 * Both transports (WS `experimental-websocket-server.ts` and SSE
 * `MessageExecutionService.ts`) attach transport-level metadata — currently
 * `skillName` for per-skill MCP tools — to the `tool` object on `tool_result`
 * / `tool_error` frames. The resolution is identical, so it lives here behind
 * a single injected resolver rather than being duplicated per transport.
 *
 * The agents service provides the resolver (it knows skill→tool mappings);
 * this package stays domain-agnostic and only owns the merge shape.
 */

/** Minimal logger contract (mirrors SSEFormatLogger). */
export interface ToolMetadataLogger {
  warn(event: string, data?: Record<string, unknown>): void
}

/**
 * Resolves transport-level metadata for a tool by its registered name.
 * Returns `undefined` (or an object without `skillName`) when there is nothing
 * to attach. Injected by the agents service; omitted in tests/PaaS.
 *
 * Error contract: this resolver is treated as **additive** — it MUST NOT throw.
 * The enrichment it feeds is purely analytics metadata on a terminal tool
 * frame; a throw must never derail an otherwise-healthy turn. `toolMetadataFields`
 * defensively swallows any throw (returning `{}`), but implementors should still
 * keep resolvers non-throwing (a `Map` lookup, etc.).
 */
export type ResolveToolMetadata = (toolName: string) => { skillName?: string } | undefined

/**
 * Compute the metadata fields to spread onto a published `tool` object.
 * Always returns a plain object (empty when there's nothing to add) so call
 * sites can use `...toolMetadataFields(name, resolve)` unconditionally.
 *
 * Called inline while building the synchronous tool_result/tool_error frame
 * literal, so a throwing resolver would otherwise abort publishing the terminal
 * frame and propagate into the turn's error path. The resolve is therefore
 * wrapped: any throw is swallowed (and optionally logged) and treated as "no
 * metadata", keeping the frame additive and the turn unaffected.
 */
export function toolMetadataFields(
  toolName: string,
  resolve?: ResolveToolMetadata,
  logger?: ToolMetadataLogger,
): { skillName?: string } {
  if (!resolve) return {}
  try {
    const meta = resolve(toolName)
    return meta?.skillName ? { skillName: meta.skillName } : {}
  } catch (err) {
    logger?.warn('tool_metadata.resolve_failed', {
      toolName,
      error: err instanceof Error ? err.message : String(err),
    })
    return {}
  }
}
