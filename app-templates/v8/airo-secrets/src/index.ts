/**
 * @airo/secrets - Backend-only secrets management utilities
 *
 * This package provides utilities for accessing non-system-managed secrets
 * from /alloc/config.json in Airo application containers.
 *
 * ⚠️ SERVER-ONLY: This package uses Node.js built-in modules and is designed
 * exclusively for server-side/container execution. It cannot be used in
 * browser/frontend code.
 *
 * @packageDocumentation
 */

export { getSecret, listSecretNames } from './secrets-utils.ts';
