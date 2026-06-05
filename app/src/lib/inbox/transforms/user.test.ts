import { describe, expect, it } from 'vitest'

import { DeletedC2 } from '@/lib/inbox/constants/user'
import { convertUser, selectC2 } from '@/lib/inbox/transforms/user'
import { RemoteUser } from '@/types/inbox/remote/user'

const makeRemoteUser = (overrides: Partial<RemoteUser> = {}): RemoteUser => ({
  id: 100,
  name: 'Jane Customer',
  friendly_name: 'Jane',
  avatar_url: null,
  email: null,
  mobile: null,
  facebook: null,
  instagram: null,
  identities: [],
  user_type: 'customer',
  ...overrides,
})

describe('convertUser', () => {
  it('maps user_type to the boolean role flags', () => {
    const customer = convertUser(makeRemoteUser({ user_type: 'customer' }))
    expect(customer).toMatchObject({ isC2: true, isC1: false, isBot: false })

    const staff = convertUser(makeRemoteUser({ user_type: 'staff' }))
    expect(staff).toMatchObject({ isC2: false, isC1: true, isBot: false })

    const system = convertUser(makeRemoteUser({ user_type: 'system' }))
    expect(system).toMatchObject({ isC2: false, isC1: false, isBot: true })
  })

  it('overrides the name for deleted users (id < 1) and sets isDeleted', () => {
    const user = convertUser(makeRemoteUser({ id: 0, name: 'whoever' }))
    expect(user.name).toBe('Deleted Contact')
    expect(user.isDeleted).toBe(true)
  })

  it('detects the Guide bot and renames it', () => {
    const user = convertUser(makeRemoteUser({ user_type: 'system', name: 'Guide' }))
    expect(user.name).toBe('GoDaddy Guide Bot')
    expect(user.isGuideBot).toBe(true)
    expect(user.isSystem).toBe(false)
  })

  it('detects the System user without renaming it', () => {
    const user = convertUser(makeRemoteUser({ user_type: 'system', name: 'System User' }))
    expect(user.name).toBe('System User')
    expect(user.isSystem).toBe(true)
    expect(user.isGuideBot).toBe(false)
  })

  it('formats a phone-number name when it starts with +', () => {
    const user = convertUser(makeRemoteUser({ name: '+14805551234' }))
    expect(user.name).toBe('(480) 555-1234')
  })

  it('lowercases the email and passes phone through unchanged', () => {
    const user = convertUser(
      makeRemoteUser({ email: 'Jane.DOE@Example.COM', mobile: '+14805551234' }),
    )
    expect(user.email).toBe('jane.doe@example.com')
    expect(user.phone).toBe('+14805551234')
  })

  it('trims whitespace from the name', () => {
    const user = convertUser(makeRemoteUser({ name: '  Jane Customer  ' }))
    expect(user.name).toBe('Jane Customer')
  })
})

describe('selectC2', () => {
  it('returns all customer users, deduped by id', () => {
    const result = selectC2([
      makeRemoteUser({ id: 1, name: 'A', user_type: 'customer' }),
      makeRemoteUser({ id: 1, name: 'A duplicate', user_type: 'customer' }),
      makeRemoteUser({ id: 2, name: 'B', user_type: 'customer' }),
      makeRemoteUser({ id: 3, name: 'Staffer', user_type: 'staff' }),
    ])
    expect(result.map((u) => u.id).sort()).toEqual([1, 2])
    expect(result.every((u) => u.isC2)).toBe(true)
  })

  it('falls back to a system user when allowBotC2 is true and there is no customer', () => {
    const result = selectC2(
      [
        makeRemoteUser({ id: 5, user_type: 'staff' }),
        makeRemoteUser({ id: 6, user_type: 'system', name: 'Guide' }),
      ],
      true,
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(6)
    expect(result[0].isGuideBot).toBe(true)
  })

  it('falls back to a staff user (self-conversation) when allowBotC2 is false', () => {
    const result = selectC2(
      [
        makeRemoteUser({ id: 6, user_type: 'system', name: 'System User' }),
        makeRemoteUser({ id: 7, user_type: 'staff' }),
      ],
      false,
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(7)
    expect(result[0].isC1).toBe(true)
  })

  it('falls back to the Deleted Contact placeholder when no candidate matches', () => {
    const result = selectC2([makeRemoteUser({ id: 6, user_type: 'system' })], false)
    expect(result).toEqual([DeletedC2])
  })

  it('defaults allowBotC2 to false', () => {
    const result = selectC2([makeRemoteUser({ id: 6, user_type: 'system' })])
    expect(result).toEqual([DeletedC2])
  })
})
