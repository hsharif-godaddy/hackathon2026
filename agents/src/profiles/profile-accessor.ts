import { getActiveProfile } from './profile-context.js'

export function profileValue<T extends string | number | boolean>(key: string, defaultValue: T): T {
  const profile = getActiveProfile()
  if (!profile) return defaultValue

  const value = profile.properties[key]
  if (value === undefined || value === null) return defaultValue
  if (typeof value !== typeof defaultValue) return defaultValue

  return value as T
}

export function profileFlag(key: string, defaultValue: boolean = false): boolean {
  return profileValue(key, defaultValue)
}

export function hasActiveProfile(): boolean {
  return getActiveProfile() !== null
}

export function activeProfileName(): string | null {
  return getActiveProfile()?.name ?? null
}
