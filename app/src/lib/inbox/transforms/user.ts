import { DeletedC2 } from '@/lib/inbox/constants/user'
import { tryFormatAsUSPhone } from '@/lib/inbox/format/phone'
import { User } from '@/types/inbox/local/user'
import { RemoteUser } from '@/types/inbox/remote/user'

/**
 * User transform utilities
 *
 * Transforms raw Reamaze user data to the internal User type.
 */

export const convertUser = (user: RemoteUser): User => {
  // name could be email or phone
  // 1. email "name" should be shown "as is"
  // 2. phone "name" should be shown as NANP
  let name = user.name.trim()
  const isDeleted = user.id < 1
  const isGuideBot = user.user_type === 'system' && name === 'Guide'
  const isSystem = user.user_type === 'system' && name === 'System User'
  // TODO: use proper localization
  // https://formatjs.io/docs/intl/#createintl
  if (isDeleted)
    // "deletedContact": "Deleted Contact"
    name = 'Deleted Contact'
  else if (isGuideBot)
    // "guideBot": "GoDaddy Guide Bot"
    name = 'GoDaddy Guide Bot'
  else if (name.startsWith('+')) name = tryFormatAsUSPhone(name)
  return {
    id: user.id,
    name,
    // TODO: user.avatar_url is actually permalink, how do we differ Re:Amaze dummy icons from actual avatars?
    avatar: user.avatar_url ?? undefined,
    // [!] normalized email format is lowercase (NOT guaranteed on Re:Amaze)
    email: user.email?.toLowerCase() ?? undefined,
    // [!] normalized phone format is E.164 (guaranteed on Re:Amaze)
    phone: user.mobile ?? undefined,
    facebook: user.facebook ?? undefined,
    instagram: user.instagram ?? undefined,
    isC2: user.user_type === 'customer',
    isC1: user.user_type === 'staff',
    isBot: user.user_type === 'system',
    isGuideBot,
    isSystem,
    isDeleted,
    connection: undefined,
  }
}

const filterUnique = <T, U>(
  array: T[],
  key: (element: T) => U,
  criteria: (element: T) => boolean,
): T[] => {
  const map = new Map<U, T>()
  for (const element of array)
    if (criteria(element)) map.set(key(element), element)
  return [...map.values()]
}

export const selectC2 = (users: RemoteUser[], allowBotC2 = false): User[] => {
  const c2s = filterUnique(
    users,
    (u) => u.id,
    (u) => u.user_type === 'customer',
  )
  if (c2s.length > 0) return c2s.map((user) => convertUser(user))
  // [!] if there is no user of type 'customer', could be 2 valid cases
  // 1. system channel (GoDaddy Guide Bot), C2 is bot
  // 2. self-conversation (C1 tests widget and enters the same email as configured for staff), C2 is C1
  const c2 = users.find((u) =>
    allowBotC2 ? u.user_type === 'system' : u.user_type === 'staff',
  )
  // fallback to "Deleted Contact"
  return [c2 ? convertUser(c2) : DeletedC2]
}
