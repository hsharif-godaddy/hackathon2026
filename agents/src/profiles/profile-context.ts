import { AsyncLocalStorage } from 'node:async_hooks'

import type { ProfileData } from './types.js'

const storage = new AsyncLocalStorage<ProfileData>()

export function runWithProfile<T>(profile: ProfileData, fn: () => T): T {
  return storage.run(profile, fn)
}

export function getActiveProfile(): ProfileData | null {
  return storage.getStore() ?? null
}
