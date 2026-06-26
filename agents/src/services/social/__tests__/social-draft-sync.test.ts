import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SimpleCampaignContent } from '../../../database/schema.js'

// The helper constructs its own repo singletons; mock all three modules so the sync is
// observable without a real DB. vi.mock replaces the module globally, so the helper's
// `new XRepository()` returns these mocks.
const { mockCampaignRepo, mockSocialPostRepo, mockUtmRepo, mockDb } = vi.hoisted(() => ({
  mockCampaignRepo: { updateContent: vi.fn(), deleteContent: vi.fn() },
  mockSocialPostRepo: { update: vi.fn(), delete: vi.fn() },
  mockUtmRepo: { deleteByContentRefId: vi.fn() },
  // db.transaction(fn) returns a function that runs fn; the helpers call it immediately
  // (`getDatabase().transaction(() => {…})()`). This stub runs fn synchronously and lets a
  // throw inside it propagate, modeling better-sqlite3's rollback-on-throw for the unit path.
  mockDb: { transaction: vi.fn((fn: () => unknown) => fn) },
}))

vi.mock('../../../database/connection.js', () => ({
  getDatabase: () => mockDb,
}))
vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: vi.fn(function () {
    return mockCampaignRepo
  }),
}))
vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function () {
    return mockSocialPostRepo
  }),
}))
vi.mock('../../../database/repositories/MarketingUtmRepository.js', () => ({
  MarketingUtmRepository: vi.fn(function () {
    return mockUtmRepo
  }),
}))

import { editSocialDraft, deleteSocialDraft } from '../social-draft-sync.js'

function draft(over: Partial<SimpleCampaignContent> = {}): SimpleCampaignContent {
  return {
    id: 'cont_1',
    simpleCampaignId: 'camp_1',
    assetType: 'social',
    contentRefId: 'post_1',
    title: 'T',
    scheduledDate: null,
    status: 'draft',
    contentPreview: 'old caption',
    imageUrl: null,
    rawContent: '{"message":"old caption","hashtags":["a"]}',
    createdBy: 'agent',
    createdAt: '2026-06-15T10:00:00Z',
    ...over,
  } as SimpleCampaignContent
}

describe('social-draft-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCampaignRepo.updateContent.mockImplementation((id: string, p: Record<string, unknown>) => ({ ...draft(), id, ...p }))
    mockCampaignRepo.deleteContent.mockReturnValue(true)
    mockSocialPostRepo.delete.mockReturnValue(true)
  })

  describe('editSocialDraft', () => {
    it('merges edits into the content row and mirrors them onto the linked social_posts payload', () => {
      editSocialDraft(draft(), { message: 'new', hashtags: ['b'] })

      const contentArg = mockCampaignRepo.updateContent.mock.calls[0][1]
      expect(JSON.parse(contentArg.rawContent)).toMatchObject({ message: 'new', hashtags: ['b'] })
      expect(contentArg.contentPreview).toBe('new')
      expect(mockSocialPostRepo.update).toHaveBeenCalledWith(
        'post_1',
        expect.objectContaining({ payload: expect.objectContaining({ message: 'new', hashtags: ['b'] }) }),
      )
    })

    it('persists scheduledDate on the content row and scheduled_at on the post', () => {
      editSocialDraft(draft(), { scheduledDate: '2026-06-27T18:00:00.000Z' })

      expect(mockCampaignRepo.updateContent.mock.calls[0][1].scheduledDate).toBe('2026-06-27T18:00:00.000Z')
      const postArg = mockSocialPostRepo.update.mock.calls[0][1]
      expect(postArg.scheduledAt).toBeInstanceOf(Date)
      expect((postArg.scheduledAt as Date).toISOString()).toBe('2026-06-27T18:00:00.000Z')
    })

    it('clears the schedule when scheduledDate is null', () => {
      editSocialDraft(draft({ scheduledDate: '2026-06-27T18:00:00.000Z' }), { scheduledDate: null })

      expect(mockCampaignRepo.updateContent.mock.calls[0][1].scheduledDate).toBeNull()
      expect(mockSocialPostRepo.update.mock.calls[0][1].scheduledAt).toBeNull()
    })

    it('leaves the schedule untouched when scheduledDate is omitted', () => {
      editSocialDraft(draft(), { message: 'new' })

      expect('scheduledDate' in mockCampaignRepo.updateContent.mock.calls[0][1]).toBe(false)
      expect('scheduledAt' in mockSocialPostRepo.update.mock.calls[0][1]).toBe(false)
    })

    it('skips the social_posts sync for an unmaterialized draft (no contentRefId)', () => {
      editSocialDraft(draft({ contentRefId: null }), { message: 'new' })

      expect(mockCampaignRepo.updateContent).toHaveBeenCalled()
      expect(mockSocialPostRepo.update).not.toHaveBeenCalled()
    })

    it('runs both writes inside a single transaction', () => {
      editSocialDraft(draft(), { message: 'new' })

      expect(mockDb.transaction).toHaveBeenCalledTimes(1)
    })

    it('propagates (rolling back) when the social_posts update throws', () => {
      mockSocialPostRepo.update.mockImplementation(() => {
        throw new Error('db write failed')
      })

      expect(() => editSocialDraft(draft(), { message: 'new' })).toThrow('db write failed')
      expect(mockDb.transaction).toHaveBeenCalled()
    })
  })

  describe('deleteSocialDraft', () => {
    it('deletes the content row and cascades to social_posts + UTM when materialized, in a transaction', () => {
      const ok = deleteSocialDraft(draft())

      expect(ok).toBe(true)
      expect(mockDb.transaction).toHaveBeenCalledTimes(1)
      expect(mockCampaignRepo.deleteContent).toHaveBeenCalledWith('cont_1')
      expect(mockSocialPostRepo.delete).toHaveBeenCalledWith('post_1')
      expect(mockUtmRepo.deleteByContentRefId).toHaveBeenCalledWith('post_1')
    })

    it('propagates (rolling back) and does not delete UTM when the linked social_posts delete throws', () => {
      mockSocialPostRepo.delete.mockImplementation(() => {
        throw new Error('db delete failed')
      })

      expect(() => deleteSocialDraft(draft())).toThrow('db delete failed')
      expect(mockUtmRepo.deleteByContentRefId).not.toHaveBeenCalled()
      expect(mockDb.transaction).toHaveBeenCalled()
    })

    it('treats an absent linked row (delete returns false) as benign, still removing UTM', () => {
      mockSocialPostRepo.delete.mockReturnValue(false)

      const ok = deleteSocialDraft(draft())

      expect(ok).toBe(true)
      expect(mockUtmRepo.deleteByContentRefId).toHaveBeenCalledWith('post_1')
    })

    it('skips the cascade for an unmaterialized draft (no contentRefId)', () => {
      deleteSocialDraft(draft({ contentRefId: null }))

      expect(mockSocialPostRepo.delete).not.toHaveBeenCalled()
      expect(mockUtmRepo.deleteByContentRefId).not.toHaveBeenCalled()
    })

    it('does not cascade when the content row was not deleted', () => {
      mockCampaignRepo.deleteContent.mockReturnValue(false)

      deleteSocialDraft(draft())

      expect(mockSocialPostRepo.delete).not.toHaveBeenCalled()
      expect(mockUtmRepo.deleteByContentRefId).not.toHaveBeenCalled()
    })
  })
})
