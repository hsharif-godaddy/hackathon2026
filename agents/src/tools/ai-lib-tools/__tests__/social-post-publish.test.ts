import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAssociationRepo, mockSocialPostRepo } = vi.hoisted(() => ({
  mockAssociationRepo: {
    findByAppAndPlatform: vi.fn(),
  },
  mockSocialPostRepo: {
    findById: vi.fn(),
  },
}));

vi.mock('../../../database/repositories/SocialAssociationRepository.js', () => ({
  SocialAssociationRepository: vi.fn(function mockSocialAssociationRepository() {
    return mockAssociationRepo;
  }),
}));

vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function mockSocialPostRepository() {
    return mockSocialPostRepo;
  }),
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { socialPostPublish } from '../social-post-publish.js';

const APP_ID = 'app_123';

function exec(input: Record<string, unknown>, contextAttachments: Array<Record<string, unknown>> = []): Promise<any> {
  return (socialPostPublish as { execute: (i: unknown, c?: unknown) => Promise<unknown> }).execute(
    input,
    {
      experimental_context: {
        metadata: { appId: APP_ID },
        contextAttachments,
      },
    }
  ) as Promise<any>;
}

describe('socialPostPublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves scheduledAt for standalone schedule requests', async () => {
    const scheduledAt = '2026-07-08T15:00:00-05:00';

    mockAssociationRepo.findByAppAndPlatform.mockReturnValue([{ id: 'assoc_1' }]);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_1',
      appId: APP_ID,
      payload: {
        message: 'Start today',
        hashtags: ['GymLife'],
        callToAction: 'Join now',
        imageUrls: ['https://cdn.example.com/image.jpg'],
        styleLabel: 'Start Today',
        topic: 'Fitness',
      },
    });

    const result = await exec(
      { platform: 'facebook', scheduledAt },
      [{ type: 'social_post_target', data: { contentId: 'post_1' } }]
    );

    expect(result.success).toBe(true);
    expect(result.pendingPublish.scheduledAt).toBeInstanceOf(Date);
    expect(result.pendingPublish.scheduledAt.toISOString()).toBe(new Date(scheduledAt).toISOString());
    expect(result.pendingPublish.platformData[0].scheduledAt).toBeInstanceOf(Date);
    expect(result.pendingPublish.platformData[0].scheduledAt.toISOString()).toBe(new Date(scheduledAt).toISOString());
  });

  it('returns connect-first error when standalone platform is not connected', async () => {
    mockAssociationRepo.findByAppAndPlatform.mockReturnValue([]);

    const result = await exec(
      { platform: 'instagram' },
      [{ type: 'social_post_target', data: { contentId: 'post_1' } }]
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Connect to Instagram first.');
    expect(mockSocialPostRepo.findById).not.toHaveBeenCalled();
  });

  it('returns platform-required error when standalone platform is missing', async () => {
    const result = await exec(
      {},
      [{ type: 'social_post_target', data: { contentId: 'post_1' } }]
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Specify platform (facebook or instagram) before publishing.');
    expect(mockAssociationRepo.findByAppAndPlatform).not.toHaveBeenCalled();
  });

  it('returns target-required error when standalone target attachment is missing', async () => {
    mockAssociationRepo.findByAppAndPlatform.mockReturnValue([{ id: 'assoc_1' }]);

    const result = await exec({ platform: 'facebook' }, []);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Select a social post first, then try publishing again.');
    expect(mockSocialPostRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects standalone post from another app', async () => {
    mockAssociationRepo.findByAppAndPlatform.mockReturnValue([{ id: 'assoc_1' }]);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_1',
      appId: 'other_app',
      payload: { message: 'x' },
    });

    const result = await exec(
      { platform: 'facebook' },
      [{ type: 'social_post_target', data: { contentId: 'post_1' } }]
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Selected social post was not found.');
  });

  it('hydrates payload from images fallback and default post fields', async () => {
    mockAssociationRepo.findByAppAndPlatform.mockReturnValue([{ id: 'assoc_1' }]);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_2',
      appId: APP_ID,
      payload: {
        message: 'Level up now',
        hashtags: ['FitnessJourney', 'GymGoals'],
        images: [{ url: 'https://cdn.example.com/fallback.jpg' }],
      },
    });

    const result = await exec(
      { platform: 'instagram' },
      [{ type: 'social_post_target', data: { contentId: 'post_2' } }]
    );

    expect(result.success).toBe(true);
    expect(result.pendingPublish.platformData[0]).toEqual({
      platform: 'instagram',
      message: 'Level up now\n\n#FitnessJourney #GymGoals',
      imageUrls: ['https://cdn.example.com/fallback.jpg'],
    });
    expect(result.postData).toEqual({
      id: 'post_2',
      styleLabel: 'Social Post',
      content: 'Level up now',
      hashtags: ['FitnessJourney', 'GymGoals'],
      platform: 'instagram',
      topic: 'social',
    });
  });
});
