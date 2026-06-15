import { describe, expect, it } from 'vitest'

import { convertConversation, convertForm } from '@/lib/inbox/transforms/conversation'
import { RemoteConversationCategory } from '@/types/inbox/remote/category'
import {
  RemoteConversation,
  RemoteConversationData,
  RemoteConversationStatus,
} from '@/types/inbox/remote/conversation'
import { RemoteMessage, RemoteOrigin } from '@/types/inbox/remote/message'
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

const makeRemoteMessage = (overrides: Partial<RemoteMessage> = {}): RemoteMessage => ({
  id: 10,
  attachments: [],
  body: 'hello',
  conversation_id: 99,
  created_at: '2026-06-01T00:00:00Z',
  origin: 1,
  origin_id: 'origin-id',
  original_body: null,
  read_by: [],
  updated_at: '2026-06-01T00:00:00Z',
  user: makeRemoteUser({ user_type: 'staff' }),
  visibility: 0,
  ...overrides,
})

const makeRemoteCategory = (
  overrides: Partial<RemoteConversationCategory> = {},
): RemoteConversationCategory => ({
  id: 1,
  name: 'Support',
  slug: 'support',
  email: 'support@example.com',
  visibility: 0,
  channel_type: 1,
  ...overrides,
})

const makeRemoteConversation = (
  overrides: Partial<RemoteConversation> = {},
): RemoteConversation => ({
  id: 555,
  category: makeRemoteCategory(),
  last_message: makeRemoteMessage(),
  origin: 1,
  message: { body: 'hello' },
  status: 0,
  origin_id: 'conv-origin-id',
  follower_count: 0,
  followers: [],
  author: makeRemoteUser(),
  starred: false,
  important: false,
  visibility: 0,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-02T00:00:00Z',
  sort_timestamp: '2026-06-02T00:00:00Z',
  message_count: 1,
  ...overrides,
})

describe('convertConversation status mapping', () => {
  it.each<[RemoteConversationStatus, string]>([
    [4, 'isArchived'],
    [3, 'isSpam'],
    [9, 'isSpam'],
  ])('status %i sets %s', (status, flag) => {
    const result = convertConversation(makeRemoteConversation({ status })) as unknown as Record<
      string,
      boolean
    >
    expect(result[flag]).toBe(true)
  })

  it.each<[RemoteConversationStatus, string]>([
    [2, 'resolved'],
    [1, 'resolved'],
    [0, 'unresolved'],
    [5, 'onHold'],
    [4, 'archived'],
    [3, 'spam'],
    [9, 'spam'],
  ])('status %i maps to ConversationStatus %s', (remoteStatus, expectedStatus) => {
    const result = convertConversation(makeRemoteConversation({ status: remoteStatus }))
    expect(result.status).toBe(expectedStatus)
  })

  it('defaults to unresolved for a non-mapped status (botAssigned = 7)', () => {
    const result = convertConversation(makeRemoteConversation({ status: 7 }))
    expect(result.isArchived).toBe(false)
    expect(result.isSpam).toBe(false)
    expect(result.status).toBe('unresolved')
  })
})

describe('convertConversation bumpedAt derivation', () => {
  it('uses the last message time when it is inbound and newer than sort_timestamp', () => {
    const result = convertConversation(
      makeRemoteConversation({
        sort_timestamp: '2026-06-02T00:00:00Z',
        last_message: makeRemoteMessage({
          user: makeRemoteUser({ user_type: 'customer' }),
          created_at: '2026-06-03T00:00:00Z',
        }),
      }),
    )
    expect(result.bumpedAt).toBe('2026-06-03T00:00:00Z')
  })

  it('falls back to sort_timestamp when the last message is outbound', () => {
    const result = convertConversation(
      makeRemoteConversation({
        sort_timestamp: '2026-06-02T00:00:00Z',
        last_message: makeRemoteMessage({
          user: makeRemoteUser({ user_type: 'staff' }),
          created_at: '2026-06-03T00:00:00Z',
        }),
      }),
    )
    expect(result.bumpedAt).toBe('2026-06-02T00:00:00Z')
  })

  it('falls back to sort_timestamp when the inbound message is older', () => {
    const result = convertConversation(
      makeRemoteConversation({
        sort_timestamp: '2026-06-02T00:00:00Z',
        last_message: makeRemoteMessage({
          user: makeRemoteUser({ user_type: 'customer' }),
          created_at: '2026-06-01T00:00:00Z',
        }),
      }),
    )
    expect(result.bumpedAt).toBe('2026-06-02T00:00:00Z')
  })
})

describe('convertConversation messageType matrix', () => {
  it('is chat for a web chat (Email category, public, origin 0) with no form', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 1 }),
        origin: 0,
      }),
    )
    expect(result.messageType).toBe('chat')
  })

  it('is contactForm when origin is Form (17)', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 1 }),
        origin: 17,
      }),
    )
    expect(result.messageType).toBe('contactForm')
  })

  it('is chat for a web chat with form data but non-form origin', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 1 }),
        origin: 0,
        data: { __gd_type: 'contact', name: 'Jane' },
      }),
    )
    expect(result.messageType).toBe('chat')
  })

  it('is email for an email category on a non-native origin', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 0 }),
        origin: 1,
      }),
    )
    expect(result.messageType).toBe('email')
  })

  it('is sms vs call for telephony based on the last message origin', () => {
    const sms = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 17 }),
        last_message: makeRemoteMessage({ origin: 9 }),
      }),
    )
    expect(sms.messageType).toBe('sms')

    const call = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 17 }),
        last_message: makeRemoteMessage({ origin: 10 }),
      }),
    )
    expect(call.messageType).toBe('call')
  })

  it.each<[number, string]>([
    [14, 'adComments'],
    [13, 'adLead'],
  ])('maps channel_type %i to messageType %s', (channelType, expected) => {
    const result = convertConversation(
      makeRemoteConversation({ category: makeRemoteCategory({ channel_type: channelType }) }),
    )
    expect(result.messageType).toBe(expected)
  })
})

describe('convertConversation subject gating', () => {
  it('exposes subject for an enabled channel (Email)', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 0 }),
        origin: 1,
        subject: 'Order #123',
      }),
    )
    expect(result.subject).toBe('Order #123')
    expect(result.title).toBe('Order #123')
  })

  it('suppresses subject for a non-enabled channel (WebChat) but keeps title', () => {
    const result = convertConversation(
      makeRemoteConversation({
        category: makeRemoteCategory({ channel_type: 1, visibility: 1 }),
        origin: 0,
        subject: 'Order #123',
      }),
    )
    expect(result.subject).toBeUndefined()
    expect(result.title).toBe('Order #123')
  })
})

describe('convertConversation starred / important gating', () => {
  it('keeps starred and important when the conversation is active', () => {
    const result = convertConversation(
      makeRemoteConversation({
        status: 0,
        starred: true,
        important: true,
        data: { __important_reason: 'VIP' },
      }),
    )
    expect(result.isStarred).toBe(true)
    expect(result.isImportant).toBe(true)
    expect(result.importantReason).toBe('VIP')
  })

  it('clears starred / important / reason when the conversation is spam', () => {
    const result = convertConversation(
      makeRemoteConversation({
        status: 3,
        starred: true,
        important: true,
        data: { __important_reason: 'VIP' },
      }),
    )
    expect(result.isStarred).toBe(false)
    expect(result.isImportant).toBe(false)
    expect(result.importantReason).toBeUndefined()
  })

  it('clears important when the conversation is archived', () => {
    const result = convertConversation(
      makeRemoteConversation({ status: 4, important: true, data: { __important_reason: 'VIP' } }),
    )
    expect(result.isImportant).toBe(false)
    expect(result.importantReason).toBeUndefined()
  })
})

describe('convertForm', () => {
  it('returns undefined when there is no form data', () => {
    expect(convertForm(undefined)).toBeUndefined()
  })

  it('returns undefined when __gd_type is absent', () => {
    const form: RemoteConversationData = { name: 'Jane' }
    expect(convertForm(form)).toBeUndefined()
  })

  it('builds a form, dropping __-prefixed and hidden fields', () => {
    const form: RemoteConversationData = {
      __gd_type: 'contact',
      __gd_contact_form_title: 'Contact us',
      name: 'Jane',
      email: 'jane@example.com',
      device: 'iPhone',
      language: 'en',
      submitted_from: 'homepage',
    }
    const result = convertForm(form)
    expect(result).toEqual({
      type: 'contact',
      title: 'Contact us',
      fields: [
        { name: 'name', value: 'Jane' },
        { name: 'email', value: 'jane@example.com' },
      ],
    })
  })

  it('returns a Form with empty fields when every field is filtered out', () => {
    const form: RemoteConversationData = { __gd_type: 'contact', device: 'iPhone' }
    expect(convertForm(form)).toEqual({
      type: 'contact',
      title: '',
      fields: [],
    })
  })

  it('honors an explicit field position ordering', () => {
    const form: RemoteConversationData = {
      __gd_type: 'contact',
      name: 'Jane',
      email: 'jane@example.com',
    }
    const result = convertForm(form, ['email', 'name'])
    expect(result?.fields).toEqual([
      { name: 'email', value: 'jane@example.com' },
      { name: 'name', value: 'Jane' },
    ])
  })

  it('defaults the title to an empty string when not provided', () => {
    const form: RemoteConversationData = { __gd_type: 'message', subject: 'Hi' }
    expect(convertForm(form)?.title).toBe('')
  })
})
