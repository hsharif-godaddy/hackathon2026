import type { AppMetadata } from './types.js';

// `__proto__`, `constructor`, and `prototype` index the prototype chain rather
// than own data; assigning them via bracket access invokes the inherited setter
// (rewiring result's prototype, then dropped by JSON.stringify). The bag never
// legitimately holds these — skip them.
const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Shallow-merge a patch into the current metadata object, last-writer-wins per
 * top-level key. Patch keys with an `undefined` value are ignored (so callers
 * can pass a partial without clobbering). Pure — does not mutate `current`.
 */
export function mergeAppMetadata(
  current: AppMetadata,
  patch: Partial<AppMetadata>
): AppMetadata {
  const result: AppMetadata = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || PROTO_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}
