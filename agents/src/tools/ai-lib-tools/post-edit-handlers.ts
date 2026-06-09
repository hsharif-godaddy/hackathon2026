/**
 * Post-edit handler registry.
 *
 * The text editor is a generic file primitive — it must not carry knowledge of
 * any specific file or template. When a mutating edit (`str_replace`, `create`,
 * `insert`) succeeds, the editor invokes `runPostEditHandlers` with the edit
 * context; any registered handler whose `matches` predicate fires gets a chance
 * to run a side effect and augment the string the agent sees.
 *
 * Template- or feature-specific behavior (e.g. mirroring v8 `src/routes.tsx`
 * into the SEO sitemap registry) lives in its own handler module and is wired
 * in at the tool composition root (`index.ts`) via `registerPostEditHandler` —
 * never embedded in the editor itself.
 */

import { relative } from 'node:path';

/** Mutating commands that can trigger post-edit handlers. */
export type PostEditCommand = 'str_replace' | 'create' | 'insert';

/** Context describing a successful mutating edit. */
export interface PostEditContext {
  /**
   * Already-validated, Docker-prefix-translated, symlink-checked absolute path
   * from `resolveFilePath`. Handlers can use this directly without re-running
   * fs-touching validation.
   */
  fullPath: string;
  /**
   * The original LLM-emitted path. Kept only for log breadcrumbs so the agent's
   * request is visible to operators — do not use for fs access.
   */
  filePath: string;
  /** The app root the edit happened in. */
  appPath: string;
  /** Which mutating command produced this edit. */
  command: PostEditCommand;
}

/**
 * A side effect that runs after a successful mutating edit to a matching file.
 *
 * `matches` receives the app-relative path (computed once by the runner) so
 * handlers don't each re-derive it. `run` receives the result string the agent
 * will see and returns it, optionally augmented with notes (e.g. sync status,
 * warnings) so the agent can self-correct on the next turn.
 */
export interface PostEditHandler {
  /** Stable identifier; also used to dedupe registration. */
  name: string;
  matches(relPath: string, context: PostEditContext): boolean;
  run(context: PostEditContext, result: string): Promise<string>;
}

const handlers: PostEditHandler[] = [];

/**
 * Register a post-edit handler. Idempotent by `name` — re-registering the same
 * handler (e.g. across HMR or repeated module evaluation) replaces the prior
 * entry rather than duplicating it.
 */
export function registerPostEditHandler(handler: PostEditHandler): void {
  const existing = handlers.findIndex((h) => h.name === handler.name);
  if (existing >= 0) {
    handlers[existing] = handler;
    return;
  }
  handlers.push(handler);
}

/** Remove all registered handlers. Intended for test isolation. */
export function clearPostEditHandlers(): void {
  handlers.length = 0;
}

/**
 * Run every matching handler against a successful edit's result, in
 * registration order. Each handler receives (and returns) the running result
 * string so multiple handlers can compose their notes.
 */
export async function runPostEditHandlers(
  context: PostEditContext,
  result: string,
): Promise<string> {
  const relPath = relative(context.appPath, context.fullPath);
  let current = result;
  for (const handler of handlers) {
    if (handler.matches(relPath, context)) {
      current = await handler.run(context, current);
    }
  }
  return current;
}
