import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockRepo = vi.hoisted(() => ({ findContentById: vi.fn(), findById: vi.fn(), updateContent: vi.fn() }));
const { mockSocialPostRepo, mockUtmRepo } = vi.hoisted(() => ({
  mockSocialPostRepo: { findById: vi.fn(), update: vi.fn(), delete: vi.fn() },
  mockUtmRepo: { deleteByContentRefId: vi.fn() },
}));
vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: vi.fn(function () { return mockRepo; }),
}));
// editSocialDraft (social-draft-sync) constructs these to mirror edits onto the linked
// social_posts row; mock them so the tool stays a unit (draftRow is unmaterialized, so they
// are not called here — the sync itself is covered in social-draft-sync.test.ts).
vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function () { return mockSocialPostRepo; }),
}));
vi.mock('../../../database/repositories/MarketingUtmRepository.js', () => ({
  MarketingUtmRepository: vi.fn(function () { return mockUtmRepo; }),
}));
// editSocialDraft wraps its writes in getDatabase().transaction(); stub it as a synchronous
// pass-through so this stays a unit (no real DB) while a throw still propagates.
vi.mock('../../../database/connection.js', () => ({
  getDatabase: () => ({ transaction: (fn: () => unknown) => fn }),
}));
vi.mock('../../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { socialPostEdit } from '../social-post-edit.js';

const APP_ID = 'app1234567';
function exec(input: Record<string, unknown>, appId: string = APP_ID): Promise<any> {
  return (socialPostEdit as { execute: (i: unknown, o?: unknown) => Promise<unknown> })
    .execute(input, { experimental_context: { metadata: { appId } } }) as Promise<any>;
}

const draftRow = {
  id: 'cont_1', simpleCampaignId: 'camp_1', assetType: 'social', contentRefId: null,
  title: 'Launch', scheduledDate: null, status: 'draft', contentPreview: 'old',
  imageUrl: null, rawContent: JSON.stringify({ message: 'old', hashtags: ['a'] }), createdBy: 'agent', createdAt: '2026-01-01',
};
// The owning campaign — carries the appId (content rows do not). Default: owned by APP_ID.
const ownerCampaign = { id: 'camp_1', appId: APP_ID, status: 'ready' };

describe('socialPostEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findById.mockReturnValue(ownerCampaign);
    mockSocialPostRepo.findById.mockReturnValue(null);
  });

  it('merges edited fields into raw_content and refreshes content_preview', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    mockRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...draftRow, ...p }));

    const res = await exec({ contentId: 'cont_1', message: 'new', hashtags: ['b'], callToAction: 'Book' });

    expect(res.success).toBe(true);
    expect(mockRepo.findById).toHaveBeenCalledWith('camp_1');
    const arg = mockRepo.updateContent.mock.calls[0][1];
    const written = JSON.parse(arg.rawContent);
    expect(written).toEqual({ message: 'new', hashtags: ['b'], callToAction: 'Book' });
    expect(arg.contentPreview).toBe('new'); // snapshot refreshed from the new message
  });

  it('preserves existing callToAction and platform when an edit does not touch them', async () => {
    mockRepo.findContentById.mockReturnValue({
      ...draftRow,
      rawContent: JSON.stringify({ message: 'old', hashtags: ['a'], callToAction: 'Old CTA', platform: 'instagram' }),
    });
    mockRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...draftRow, ...p }));

    const res = await exec({ contentId: 'cont_1', message: 'new' });

    expect(res.success).toBe(true);
    const written = JSON.parse(mockRepo.updateContent.mock.calls[0][1].rawContent);
    expect(written).toEqual({ message: 'new', hashtags: ['a'], callToAction: 'Old CTA', platform: 'instagram' });
  });

  it('rejects editing a post that belongs to a different app', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: 'zzz9999999', status: 'ready' });
    const res = await exec({ contentId: 'cont_1', message: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i); // cross-app is surfaced as not-found, never leaks existence
    expect(mockRepo.updateContent).not.toHaveBeenCalled();
  });

  it('rejects editing a post whose campaign has launched (status past ready)', async () => {
    // contentRefId is stamped at approve, so a launched post still has one; the launch
    // boundary is the campaign status leaving draft/ready, not contentRefId.
    mockRepo.findContentById.mockReturnValue({ ...draftRow, contentRefId: 'post-123' });
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: APP_ID, status: 'active' });
    const res = await exec({ contentId: 'cont_1', message: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/launch/i);
    expect(mockRepo.updateContent).not.toHaveBeenCalled();
  });

  it('allows editing a materialized draft while the campaign is still pre-launch', async () => {
    // A freshly-approved draft already carries a contentRefId but stays editable.
    mockRepo.findContentById.mockReturnValue({ ...draftRow, contentRefId: 'post-123' });
    mockRepo.findById.mockReturnValue({ id: 'camp_1', appId: APP_ID, status: 'ready' });
    mockRepo.updateContent.mockImplementation((_id: string, p: Record<string, unknown>) => ({ ...draftRow, ...p }));
    const res = await exec({ contentId: 'cont_1', message: 'new' });
    expect(res.success).toBe(true);
    expect(mockRepo.updateContent).toHaveBeenCalled();
  });

  it('returns not-found when the content row is missing', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    const res = await exec({ contentId: 'nope', message: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('edits a standalone draft social post when content id is the post id', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_123',
      appId: APP_ID,
      state: 'DRAFT',
      payload: { message: 'old', hashtags: ['a'], callToAction: 'Old CTA' },
    });
    mockSocialPostRepo.update.mockReturnValue({
      id: 'post_123',
      appId: APP_ID,
      state: 'DRAFT',
      payload: { message: 'new', hashtags: ['b'], callToAction: 'Book now' },
    });

    const res = await exec({ contentId: 'post_123', message: 'new', hashtags: ['b'], callToAction: 'Book now' });

    expect(res.success).toBe(true);
    expect(mockSocialPostRepo.update).toHaveBeenCalledWith(
      'post_123',
      { payload: { message: 'new', hashtags: ['b'], callToAction: 'Book now' } },
    );
  });

  it('preserves standalone message and hashtags on callToAction-only edit', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_123',
      appId: APP_ID,
      state: 'DRAFT',
      payload: { message: 'old', hashtags: ['a'], callToAction: 'Old CTA', platform: 'instagram' },
    });

    const res = await exec({ contentId: 'post_123', callToAction: 'New CTA' });

    expect(res.success).toBe(true);
    expect(mockSocialPostRepo.update).toHaveBeenCalledWith(
      'post_123',
      { payload: { message: 'old', hashtags: ['a'], callToAction: 'New CTA', platform: 'instagram' } },
    );
  });

  it('rejects editing a standalone social post that belongs to another app', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_123',
      appId: 'other-app',
      state: 'DRAFT',
      payload: { message: 'old', hashtags: [] },
    });

    const res = await exec({ contentId: 'post_123', message: 'new' });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(mockSocialPostRepo.update).not.toHaveBeenCalled();
  });

  it('rejects editing a standalone social post after draft state', async () => {
    mockRepo.findContentById.mockReturnValue(null);
    mockSocialPostRepo.findById.mockReturnValue({
      id: 'post_123',
      appId: APP_ID,
      state: 'PUBLISHED',
      payload: { message: 'old', hashtags: [] },
    });

    const res = await exec({ contentId: 'post_123', message: 'new' });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/managed on the platform/i);
    expect(mockSocialPostRepo.update).not.toHaveBeenCalled();
  });

  it('returns a structured error when no editable fields are provided', async () => {
    mockRepo.findContentById.mockReturnValue(draftRow);
    const res = await exec({ contentId: 'cont_1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no changes/i);
    expect(mockRepo.updateContent).not.toHaveBeenCalled();
  });

  it('rejects editing a non-social asset', async () => {
    mockRepo.findContentById.mockReturnValue({ ...draftRow, assetType: 'blog' });
    const res = await exec({ contentId: 'cont_1', message: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/social/i);
    expect(mockRepo.updateContent).not.toHaveBeenCalled();
  });
});
