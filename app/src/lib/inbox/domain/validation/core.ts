import { Optional } from '@/types/inbox/local/core'

export const isAnyOf = <T>(value: T, ...variants: T[]): boolean =>
  variants.includes(value)

export const enumOrDefault = <T extends string>(
  value: Optional<string>,
  variants: T[],
  def: T,
): T => (value && variants.includes(value as T) ? (value as T) : def)
