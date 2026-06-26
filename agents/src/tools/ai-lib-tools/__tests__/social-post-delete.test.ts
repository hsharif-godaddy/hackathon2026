import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockRepo = vi.hoisted(() => ({ findContentById: vi.fn(), findById: vi.fn(), deleteContent: vi.fn() }));
const { mockSocialPostRepo, mockUtmRepo } = vi.hoisted(() => ({
  mockSocialPostRepo: { update: vi.fn(), delete: vi.fn() },
  mockUtmRepo: { deleteByContentRefId: vi.fn() },
}));
vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: vi.fn(function () { return mockRepo; }),
}));
// deleteSocialDraft (social-draft-sync) constructs these to cascade-delete the linked
// social_posts row + its UTM attribution when the draft was materialized.
vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function () { return mockSocialPostRepo; }),
}));
vi.mock('../../../database/repositories/MarketingUtmRepository.js', () => ({
  MarketingUtmRepository: vi.fn(function () { return mockUtmRepo; }),
}));
// deleteSocialDraft wraps its cascade in getDatabase().transaction(); stub it as a
// synchronous pass-through so this stays a unit (no real DB) while a throw still propagates.
vi.mock('../../../database/connection.js', () => ({
  getDatabase: () => ({ transaction: (fn: () => unknown) => fn }),
}));
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { socialPostDelete } from '../social-post-delete.js';

const APP_ID = 'app1234567';
function exec(input: Record<string, unknown>, appId: string = APP_ID): Promise<any> {
  return (socialPostDelete as { execute: (i: unknown, o?: unknown) => Promise<unknown> })
    .execute(input, { experimental_context: { metadata: { appId } } }) as Promise<any>;
}

const draftRow = {
  id: 'cont_1', simpleCampaignId: 'camp_1', assetType: 'social', contentRefId: null,
  title: 'Launch', scheduledDate: null, status: 'draft', contentPreview: 'x',
  imageUrl: null, rawContent: '{"message":"x","hashtags":[]}', createdBy: 'agent', createdAt: '2026-01-01',
};
const ownerCampaign = { id: 'camp_1', appId: APP_ID, status: 'ready' };

describe('socialPostDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findById.mockReturnValue(ownerCampaign);
  });

  it('deletes a pre-launch draft', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    mockRepo.deleteContent.mockReturnValue(true);
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(true);
    expect(mockRepo.findById).toHaveBeenCalledWith('camp_1');
    expect(mockRepo.deleteContent).toHaveBeenCalledWith('cont_1');
  });

  it('cascades to the linked social_posts row + UTM for a materialized draft (contentRefId set)', async () => {
    mockRepo.findContentById.mockReturnValue({ ...draftRow, contentRefId: 'post_123' });
    mockRepo.deleteContent.mockReturnValue(true);
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(true);
    expect(mockSocialPostRepo.delete).toHaveBeenCalledWith('post_123');
    expect(mockUtmRepo.deleteByContentRefId).toHaveBeenCalledWith('post_123');
  });

  it('reports failure when the row vanishes between the guard and the delete', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    mockRepo.deleteContent.mockReturnValue(false);
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/failed to delete/i);
  });

  it('rejects deleting a post that belongs to a different app', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: 'zzz9999999', status: 'ready' });
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(mockRepo.deleteContent).not.toHaveBeenCalled();
  });

  it('rejects deleting a post whose campaign has launched (status past ready)', async () => {
    // The post keeps its approve-time contentRefId; the launch boundary is campaign status.
    mockRepo.findContentById.mockReturnValue({ ...draftRow, contentRefId: 'post-123' });
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: APP_ID, status: 'active' });
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/launch/i);
    expect(mockRepo.deleteContent).not.toHaveBeenCalled();
  });

  it('allows deleting a materialized draft while the campaign is still pre-launch', async () => {
    mockRepo.findContentById.mockReturnValue({ ...draftRow, contentRefId: 'post-123' });
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: APP_ID, status: 'ready' });
    mockRepo.deleteContent.mockReturnValue(true);
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(true);
    expect(mockRepo.deleteContent).toHaveBeenCalledWith('cont_1');
  });

  it('returns not-found when the row is missing', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    const res = await exec({ contentId: 'nope' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('rejects deleting a non-social asset', async () => {
    mockRepo.findContentById.mockReturnValue({ ...draftRow, assetType: 'blog' });
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/social/i);
    expect(mockRepo.deleteContent).not.toHaveBeenCalled();
  });
});
