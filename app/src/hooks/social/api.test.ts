import { beforeEach, describe, expect, it, vi } from 'vitest'

import { publishToPlatform } from './api'

vi.mock('@/lib/marketing-api', () => ({
  scheduleInstagramPost: vi.fn(),
}))

vi.mock('@/lib/social', () => ({
  SocialV2Client: class SocialV2Client {
    publishToFacebook = vi.fn()
    publishToInstagram = vi.fn()
  },
}))

vi.mock('@/lib/utils/social-type-guards', () => ({
  isFacebookConnection: vi.fn(() => false),
  isInstagramConnection: vi.fn(() => true),
}))

import { scheduleInstagramPost } from '@/lib/marketing-api'

describe('social api publish gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws for scheduled Instagram publish when scheduling is disabled', async () => {
    const pendingPublish = {
      platforms: ['instagram'],
      platformData: [{
        platform: 'instagram',
        message: 'Test message',
        imageUrls: ['https://example.com/image.jpg'],
        scheduledAt: new Date('2026-07-20T10:30:00.000Z'),
      }],
      message: 'Test message',
      imageUrls: ['https://example.com/image.jpg'],
      scheduledAt: new Date('2026-07-20T10:30:00.000Z'),
    }

    const connection = {
      socialId: 'social-123',
    }

    await expect(
      publishToPlatform(pendingPublish as any, connection as any, {
        instagramSchedulingUnavailable: 'instagram-scheduling-disabled',
      })
    ).rejects.toThrow('instagram-scheduling-disabled')

    expect(scheduleInstagramPost).not.toHaveBeenCalled()
  })
})
