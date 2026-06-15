import { describe, expect, it } from 'vitest'

import { primaryParticipantName } from '@/lib/inbox/conversationParticipant'
import { User } from '@/types/inbox/local/user'

function makeUser(name: string): User {
  return { id: '1', name } as unknown as User
}

describe('primaryParticipantName', () => {
  it('returns empty string for empty c2 array', () => {
    expect(primaryParticipantName({ c2: [] })).toBe('')
  })

  it('returns name for single participant with name', () => {
    expect(primaryParticipantName({ c2: [makeUser('Jane')] })).toBe('Jane')
  })

  it('returns empty string for single participant with empty name', () => {
    expect(primaryParticipantName({ c2: [makeUser('')] })).toBe('')
  })

  it('joins names with comma for multiple participants', () => {
    const result = primaryParticipantName({
      c2: [makeUser('Jane'), makeUser('John')],
    })
    expect(result).toBe('Jane, John')
  })

  it('filters out empty names from multiple participants', () => {
    const result = primaryParticipantName({
      c2: [makeUser('Jane'), makeUser(''), makeUser('Bob')],
    })
    expect(result).toBe('Jane, Bob')
  })

  it('returns empty string when all participants have empty names', () => {
    const result = primaryParticipantName({
      c2: [makeUser(''), makeUser('')],
    })
    expect(result).toBe('')
  })
})
