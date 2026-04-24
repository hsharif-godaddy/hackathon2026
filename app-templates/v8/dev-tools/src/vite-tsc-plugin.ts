import type { Plugin } from 'vite';

/**
 * No-op stub retained for backwards compatibility.
 *
 * The original `tscWatchPlugin` ran `tsc --noEmit` on the client during dev
 * and surfaced errors via HMR. That behavior was moved server-side in
 * PR #2947 (post-stream validator in `agents/`), and the plugin file was
 * deleted. Customer apps whose `vite.config.ts` has been modified (and
 * therefore won't be auto-synced by `sync-template-files.js`) still
 * `import { tscWatchPlugin } from "./dev-tools/src/vite-tsc-plugin"` and
 * call it in their dev plugins array. Without this file the dev server
 * fails to start with `Could not resolve "./dev-tools/src/vite-tsc-plugin"`.
 *
 * This stub keeps those configs booting; type-checking is now handled by
 * the server-side validator and no client-side work is required.
 */
export function tscWatchPlugin(): Plugin {
  return {
    name: 'tsc-watch-plugin-noop',
    apply: 'serve',
  };
}
