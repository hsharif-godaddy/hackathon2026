import { getDatabase } from '../../database/connection.js'
import { SimpleCampaignRepository } from '../../database/repositories/SimpleCampaignRepository.js'
import { SocialPostRepository } from '../../database/repositories/SocialPostRepository.js'
import { MarketingUtmRepository } from '../../database/repositories/MarketingUtmRepository.js'
import { mergeSocialRawContent, serializeSocialRawContent, type SocialRawContent, type SocialRawContentEdits } from './social-raw-content.js'
import type { SimpleCampaignContent } from '../../database/schema.js'

const campaignRepo = new SimpleCampaignRepository()
const socialPostRepo = new SocialPostRepository()
const utmRepo = new MarketingUtmRepository()

/**
 * Edits applicable to a campaign social draft: the raw-content fields plus an optional
 * reschedule. `scheduledDate` is an ISO date(time) string; `null` (or empty) clears it.
 * Omitting `scheduledDate` leaves the existing schedule untouched.
 */
export interface SocialDraftEdits extends SocialRawContentEdits {
  scheduledDate?: string | null
}

/**
 * Edit a pre-launch social draft, keeping the two stores it spans in sync.
 *
 * A campaign social asset lives in two places: `simple_campaign_content` (the editable
 * campaign projection — `raw_content` + `content_preview`, and `scheduled_date`) and, once
 * materialized at approve, a linked `social_posts` row (the platform-bound record that
 * publish/launch reads, keyed by the content row's `contentRefId`). Editing only the content
 * row left `social_posts.payload` stale, so the post that would actually publish no longer
 * matched the edit. This mirrors the merged content into `social_posts.payload` (and
 * `scheduled_at` on reschedule) whenever the draft has been materialized.
 *
 * Both writes run in a single transaction so a failure mid-cascade rolls back rather than
 * leaving `raw_content` edited while `social_posts.payload` stays stale (divergent stores).
 *
 * Returns the updated content row.
 */
export function editSocialDraft(content: SimpleCampaignContent, edits: SocialDraftEdits): SimpleCampaignContent {
  const next: SocialRawContent = mergeSocialRawContent(content.rawContent, edits, content.contentPreview ?? '')
  const reschedule: boolean = edits.scheduledDate !== undefined
  return getDatabase().transaction((): SimpleCampaignContent => {
    const updated: SimpleCampaignContent = campaignRepo.updateContent(content.id, {
      rawContent: serializeSocialRawContent(next),
      contentPreview: next.message,
      ...(reschedule ? { scheduledDate: edits.scheduledDate || null } : {}),
    })
    if (content.contentRefId) {
      socialPostRepo.update(content.contentRefId, {
        payload: next,
        ...(reschedule ? { scheduledAt: edits.scheduledDate ? new Date(edits.scheduledDate) : null } : {}),
      })
    }
    return updated
  })()
}

/**
 * Delete a pre-launch social draft, cascading to the records it spawned. Deleting only the
 * content row orphaned the materialized `social_posts` row and its UTM attribution; this also
 * removes the linked `social_posts` row and its UTM rows when the draft was materialized.
 *
 * The cascade runs in a single transaction so a mid-cascade failure rolls back rather than
 * leaving an orphaned `social_posts` row (and its UTM attribution) behind with the caller
 * told it succeeded. `socialPostRepo.delete()`/`update()` now re-throw on a genuine DB error
 * (rather than swallowing it as `false`), so such a failure propagates out of the transaction
 * and rolls the whole cascade back. An absent linked row is benign and does not fail.
 *
 * Returns whether the content row was deleted.
 */
export function deleteSocialDraft(content: SimpleCampaignContent): boolean {
  return getDatabase().transaction((): boolean => {
    const deleted: boolean = campaignRepo.deleteContent(content.id)
    if (deleted && content.contentRefId) {
      socialPostRepo.delete(content.contentRefId)
      utmRepo.deleteByContentRefId(content.contentRefId)
    }
    return deleted
  })()
}
