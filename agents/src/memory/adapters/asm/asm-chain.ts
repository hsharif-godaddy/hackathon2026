import type { AsmMessage } from './asm-types.js';

/**
 * Walks the responseTo pointers from HEAD back to root and returns messages
 * in chronological order (oldest first). Includes cycle detection to guard
 * against corrupt data.
 */
export function walkLinearChain(messages: AsmMessage[]): AsmMessage[] {
  if (messages.length === 0) return [];

  const byId = new Map<string, AsmMessage>();
  const referencedIds = new Set<string>();

  for (const msg of messages) {
    byId.set(msg.id, msg);
    const parentId = msg.responseTo?.[0];
    if (parentId) referencedIds.add(parentId);
  }

  let head: AsmMessage | undefined;
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

  const chain: AsmMessage[] = [];
  const seen = new Set<string>();
  let current: AsmMessage | undefined = head;

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
