import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentContext } from '../server/middleware/jwt-auth.js';

const storage = new AsyncLocalStorage<AgentContext>();

export function runWithAgentContext<T>(ctx: AgentContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getActiveAgentContext(): AgentContext | null {
  return storage.getStore() ?? null;
}
