import { describe, it, expect, beforeEach } from 'vitest'

import { CampaignRepository } from '../CampaignRepository.js'

describe('CampaignRepository', function repoTests() {
  let repo: CampaignRepository

  beforeEach(function setup() {
    repo = new CampaignRepository()
  })

  it('maps legacy active status to launched on read', function activeToLaunched() {
    const created = repo.create({
      appId: 'app-active-map',
      name: 'Legacy Active',
      campaignType: 'landing-page',
      offer: 'Test offer',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    })

    const db = (repo as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
    db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run('active', created.id)

    const campaign = repo.getById(created.id)
    expect(campaign?.status).toBe('launched')
  })
})
