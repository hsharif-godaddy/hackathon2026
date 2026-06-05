import { describe, expect, it } from 'vitest'

import { convertAttachment, convertMessage } from '@/lib/inbox/transforms/message'
import {
  RemoteAttachment,
  RemoteMessage,
  RemoteOrigin,
} from '@/types/inbox/remote/message'
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

const makeRemoteAttachment = (
  overrides: Partial<RemoteAttachment> = {},
): RemoteAttachment => ({
  id: 1,
  url: 'https://cdn.example.com/a',
  file_content_type: 'image/png',
  file_file_name: null,
  file_file_size: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
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

describe('convertAttachment', () => {
  it('uses file_file_name directly when it looks like a filename', () => {
    const attachment = convertAttachment(
      makeRemoteAttachment({
        file_content_type: 'application/octet-stream',
        file_file_name: 'nsfw.xxx',
      }),
    )
    expect(attachment.name).toBe('nsfw.xxx')
    expect(attachment.extension).toBe('xxx')
  })

  it('synthesizes a filename from the id and media-type extension when no name is present', () => {
    const attachment = convertAttachment(
      makeRemoteAttachment({ id: 42, file_content_type: 'image/png', file_file_name: null }),
    )
    expect(attachment.name).toBe('42.png')
    expect(attachment.extension).toBe('png')
  })

  it('falls back to a synthetic filename for a presigned-URL querystring (no plain filename to extract)', () => {
    // A real S3 presigned-URL querystring is not a plain filename (it contains
    // ?/&/= and the signature is hex with no extension), so it cannot be used
    // verbatim — the synthetic id.ext name is produced instead.
    const attachment = convertAttachment(
      makeRemoteAttachment({
        id: 7,
        file_content_type: 'image/png',
        file_file_name:
          'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=fe5f80f77d5fa3beca038a248ff027d0445342fe2855ddc963176630326f1024',
      }),
    )
    expect(attachment.name).toBe('7.png')
    expect(attachment.extension).toBe('png')
  })

  it('leaves name/extension undefined when nothing yields a filename', () => {
    const attachment = convertAttachment(
      makeRemoteAttachment({ file_content_type: 'application/octet-stream', file_file_name: null }),
    )
    expect(attachment.name).toBeUndefined()
    expect(attachment.extension).toBeUndefined()
  })

  it('defaults size to 0 when file_file_size is null', () => {
    const attachment = convertAttachment(makeRemoteAttachment({ file_file_size: null }))
    expect(attachment.size).toBe(0)
  })

  it('carries through size, url and parsed media type', () => {
    const attachment = convertAttachment(
      makeRemoteAttachment({
        url: 'https://cdn.example.com/x',
        file_file_size: 1234,
        file_content_type: 'image/png',
      }),
    )
    expect(attachment.size).toBe(1234)
    expect(attachment.url).toBe('https://cdn.example.com/x')
    expect(attachment.type).toBe('image')
    expect(attachment.failed).toBe(false)
  })
})

describe('convertMessage isInbound', () => {
  it('is inbound when the author is a customer (C2)', () => {
    const message = convertMessage(
      makeRemoteMessage({ origin: 1, user: makeRemoteUser({ user_type: 'customer' }) }),
    )
    expect(message.isInbound).toBe(true)
  })

  it('is inbound for the Guide bot on origin 20', () => {
    const message = convertMessage(
      makeRemoteMessage({ origin: 20, user: makeRemoteUser({ user_type: 'system', name: 'Guide' }) }),
    )
    expect(message.isInbound).toBe(true)
  })

  it('is NOT inbound for the Guide bot on a non-20 origin', () => {
    const message = convertMessage(
      makeRemoteMessage({ origin: 1, user: makeRemoteUser({ user_type: 'system', name: 'Guide' }) }),
    )
    expect(message.isInbound).toBe(false)
  })

  it('is inbound for the System user on origin 3', () => {
    const message = convertMessage(
      makeRemoteMessage({
        origin: 3,
        user: makeRemoteUser({ user_type: 'system', name: 'System User' }),
      }),
    )
    expect(message.isInbound).toBe(true)
  })

  it('is NOT inbound for a staff reply', () => {
    const message = convertMessage(
      makeRemoteMessage({ origin: 1, user: makeRemoteUser({ user_type: 'staff' }) }),
    )
    expect(message.isInbound).toBe(false)
  })
})

describe('convertMessage attachments', () => {
  it('filters out invalid attachments and counts them as blocked', () => {
    const message = convertMessage(
      makeRemoteMessage({
        attachments: [
          makeRemoteAttachment({ id: 1, metadata: undefined }),
          makeRemoteAttachment({ id: 2, metadata: 'invalid' }),
          makeRemoteAttachment({ id: 3, metadata: 'invalid' }),
        ],
      }),
    )
    expect(message.attachments.map((a) => a.id)).toEqual([1])
    expect(message.blockedAttachmentCount).toBe(2)
    expect(message.hasAttachments).toBe(true)
  })

  it('reports hasAttachments false when every attachment is invalid', () => {
    const message = convertMessage(
      makeRemoteMessage({
        attachments: [makeRemoteAttachment({ id: 1, metadata: 'invalid' })],
      }),
    )
    expect(message.hasAttachments).toBe(false)
    expect(message.attachments).toHaveLength(0)
    expect(message.blockedAttachmentCount).toBe(1)
  })
})

describe('convertMessage flags and bodies', () => {
  it.each<[RemoteOrigin, 'isCall' | 'isSms']>([
    [10, 'isCall'],
    [9, 'isSms'],
  ])('sets %s flag from origin %i', (origin, flag) => {
    const message = convertMessage(makeRemoteMessage({ origin }))
    expect(message[flag]).toBe(true)
  })

  it('only surfaces originalBody for email (origin 1)', () => {
    const asEmail = convertMessage(
      makeRemoteMessage({ origin: 1, original_body: '  original  ' }),
    )
    expect(asEmail.hasOriginalBody).toBe(true)
    expect(asEmail.originalBody).toBe('original')

    const asChat = convertMessage(
      makeRemoteMessage({ origin: 6, original_body: 'original' }),
    )
    expect(asChat.hasOriginalBody).toBe(false)
    expect(asChat.originalBody).toBeUndefined()
  })

  it('trims the body and reflects emptiness in hasBody', () => {
    expect(convertMessage(makeRemoteMessage({ body: '  hi  ' }))).toMatchObject({
      body: 'hi',
      hasBody: true,
    })
    expect(convertMessage(makeRemoteMessage({ body: '   ' }))).toMatchObject({
      body: undefined,
      hasBody: false,
    })
  })

  it('maps message visibility to hidden / internal-note flags', () => {
    expect(convertMessage(makeRemoteMessage({ visibility: 4 })).hidden).toBe(true)
    expect(convertMessage(makeRemoteMessage({ visibility: 1 })).isInternalNote).toBe(true)
    const normal = convertMessage(makeRemoteMessage({ visibility: 0 }))
    expect(normal.hidden).toBe(false)
    expect(normal.isInternalNote).toBe(false)
  })
})
