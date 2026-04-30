import type { SSEWriter } from '@airo/ai-transport'
import { SSESubscriber } from '@airo/ai-transport'
import { safeFormatSSEEvent } from './sse-event-formatter.js'
import { logger } from '../../logging/index.js'

const MAX_CONNECTIONS_PER_CONVERSATION = 10

function safeCall(fn: () => void, event: string, ctx: Record<string, unknown>): void {
  try {
    fn()
  } catch (err) {
    logger.warn(event, {
      ...ctx,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

interface SSEConnection {
  conversationId: string
  appId: string
  writer: SSEWriter
  subscriber: SSESubscriber
}

export class EventStreamRegistry {
  private connections = new Map<string, Set<SSEConnection>>()

  register(conversationId: string, appId: string, writer: SSEWriter): { subscriber: SSESubscriber } {
    const subscriber = new SSESubscriber(writer, appId, logger)

    if (!this.connections.has(conversationId)) {
      this.connections.set(conversationId, new Set())
    }

    const convConns = this.connections.get(conversationId)!

    if (convConns.size >= MAX_CONNECTIONS_PER_CONVERSATION) {
      const oldest = convConns.values().next().value
      if (oldest) {
        logger.warn('sse.registry.evict_oldest', {
          conversationId,
          appId: oldest.appId,
          capacity: MAX_CONNECTIONS_PER_CONVERSATION,
        })
        this.removeConnection(convConns, oldest, { endWriter: true })
      }
    }

    const connection: SSEConnection = { conversationId, appId, writer, subscriber }
    convConns.add(connection)

    return { subscriber }
  }

  unregister(conversationId: string, subscriber: SSESubscriber): void {
    const conns = this.connections.get(conversationId)
    if (!conns) return
    for (const conn of conns) {
      if (conn.subscriber === subscriber) {
        this.removeConnection(conns, conn, { endWriter: false })
        break
      }
    }
    if (conns.size === 0) this.connections.delete(conversationId)
  }

  // Each step is isolated so a throw from dispose() or writer.end() (e.g. an
  // already-destroyed zlib stream) can't leave the Set holding a dead
  // connection or, on the eviction path, prevent the new connection from
  // reaching .end().
  private removeConnection(
    conns: Set<SSEConnection>,
    conn: SSEConnection,
    opts: { endWriter: boolean },
  ): void {
    const ctx = { conversationId: conn.conversationId, appId: conn.appId }
    safeCall(() => conn.subscriber.dispose(), 'sse.registry.dispose_failed', ctx)
    if (opts.endWriter) {
      safeCall(() => conn.writer.end(), 'sse.registry.writer_end_failed', ctx)
    }
    conns.delete(conn)
  }

  /**
   * Broadcast an event to every connected writer for a conversation.
   *
   * Silent drops (not guaranteed delivery):
   *  - Returns immediately when no connections exist for the conversation.
   *  - Returns when safeFormatSSEEvent fails (BigInt / circular refs);
   *    the failure is logged as sse.format_failed.
   *  - Writers that throw during write are pruned from the set.
   *
   * Do NOT use this for control-plane events that require delivery
   * confirmation — callers have no way to distinguish these drops from
   * "all writers received it."
   */
  sendToAll(conversationId: string, type: string, data: Record<string, unknown>): void {
    const conns = this.connections.get(conversationId)
    if (!conns) return
    // safeFormatSSEEvent catches JSON.stringify throws (BigInt, circular
    // refs). A null return drops the event rather than corrupting the
    // caller's control flow.
    const sseText = safeFormatSSEEvent(type, data, undefined, logger, { conversationId, kind: type })
    if (!sseText) return
    const dead: SSEConnection[] = []
    for (const conn of Array.from(conns)) {
      try {
        conn.writer.write(sseText)
      } catch (err) {
        logger.warn('sse.registry.write_failed', {
          conversationId,
          appId: conn.appId,
          error: err instanceof Error ? err.message : String(err),
          errorCode: (err as NodeJS.ErrnoException | undefined)?.code,
        })
        dead.push(conn)
      }
    }
    for (const conn of dead) {
      this.removeConnection(conns, conn, { endWriter: false })
    }
    if (conns.size === 0) this.connections.delete(conversationId)
  }

  getSubscribers(conversationId: string): SSESubscriber[] {
    const conns = this.connections.get(conversationId)
    if (!conns) return []
    return Array.from(conns).map(c => c.subscriber)
  }

  getAppForConversation(conversationId: string): string | undefined {
    const conns = this.connections.get(conversationId)
    if (!conns || conns.size === 0) return undefined
    return conns.values().next().value?.appId
  }

  getConnectionCount(conversationId: string): number {
    return this.connections.get(conversationId)?.size ?? 0
  }

  hasConnections(conversationId: string): boolean {
    return this.getConnectionCount(conversationId) > 0
  }

  getConversationsByApp(appId: string): string[] {
    const result: string[] = []
    for (const [conversationId, conns] of this.connections) {
      for (const conn of conns) {
        if (conn.appId === appId) {
          result.push(conversationId)
          break
        }
      }
    }
    return result
  }

  sendToApp(appId: string, type: string, data: Record<string, unknown>): void {
    for (const conversationId of this.getConversationsByApp(appId)) {
      this.sendToAll(conversationId, type, data)
    }
  }
}
