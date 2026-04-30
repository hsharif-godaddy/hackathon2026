/**
 * Stable session key shape used by SSE for the lifecycle session store,
 * grant session manager, and external action service registry. The
 * `sse:` prefix distinguishes these keys from Socket.IO `socketId`
 * entries that share the same maps.
 */
export const sseSessionKey = (conversationId: string): string => `sse:${conversationId}`
