import type { Message } from '@gd-asm/asm-client';

/**
 * Walks the responseTo pointers from HEAD back to root and returns messages
 * in chronological order (oldest first). Includes cycle detection to guard
 * against corrupt data.
 */
export function walkLinearChain(messages: Message[]): Message[] {
  if (messages.length === 0) return [];

  const byId = new Map<string, Message>();
  const referencedIds = new Set<string>();

  for (const msg of messages) {
    byId.set(msg.id, msg);
    const parentId = msg.responseTo?.[0];
    if (parentId) referencedIds.add(parentId);
  }

  let head: Message | undefined;
  for (const msg of messages) {
    if (!referencedIds.has(msg.id)) {
      if (!head || msg.createdAt > head.createdAt) {
        head = msg;
      }
    }
  }

  if (!head) {
    head = messages[messages.length - 1];
  }

  const chain: Message[] = [];
  const seen = new Set<string>();
  let current: Message | undefined = head;

  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    chain.push(current);
    const parentId = current.responseTo?.[0];
    if (!parentId) break;
    current = byId.get(parentId);
  }

  chain.reverse();
  return chain;
}
