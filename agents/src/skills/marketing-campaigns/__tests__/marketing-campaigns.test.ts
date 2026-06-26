import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Stable mocks for the KV memory store backing the brand-signal persist side effect.
const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockGet, set: mockSet }),
}))
vi.mock('../../../memory/interfaces/scope.js', () => ({
  workspaceScopeFromAppId: vi.fn(() => ({ scope: 'test' })),
  customerIdFromContext: vi.fn(() => undefined),
}))
vi.mock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn() }))

// Mock the social-association repo so the deterministic social-connection check in
// campaignPlanCreate is driven by the test, not by real DB rows.
const { mockSocialFindByAppId } = vi.hoisted(() => ({ mockSocialFindByAppId: vi.fn() }))
vi.mock('../../../database/repositories/SocialAssociationRepository.js', () => ({
  SocialAssociationRepository: class {
    findByAppId(...args: unknown[]): unknown {
      return mockSocialFindByAppId(...args)
    }
  },
}))

// Mock the campaign repo too so campaignPlanCreate's persistence path doesn't hit
// the real SQLite (which has an apps FK the unit test doesn't seed). This keeps the
// test focused on the deterministic social-connection logic.
const { mockCampaignFindByAppId, mockCampaignCreate, mockCampaignTransition, mockCampaignAddContent, mockCampaignDelete } = vi.hoisted(() => ({
  mockCampaignFindByAppId: vi.fn((): unknown[] => []),
  mockCampaignCreate: vi.fn((): unknown => ({ id: 'camp_test' })),
  mockCampaignTransition: vi.fn((id: string): unknown => ({ id, status: 'ready' })),
  mockCampaignAddContent: vi.fn((): unknown => ({})),
  mockCampaignDelete: vi.fn(),
}))
vi.mock('../../../database/repositories/SimpleCampaignRepository.js', () => ({
  SimpleCampaignRepository: class {
    findByAppId(...args: unknown[]): unknown { return mockCampaignFindByAppId(...args) }
    create(...args: unknown[]): unknown { return mockCampaignCreate(...args) }
    transition(...args: unknown[]): unknown { return mockCampaignTransition(...args) }
    addContent(...args: unknown[]): unknown { return mockCampaignAddContent(...args) }
    delete(...args: unknown[]): unknown { return mockCampaignDelete(...args) }
  },
}))

import { tools, campaignPlanPropose, campaignPlanCreate, campaignCreate, campaignScaffoldPage, sanitizeSlug, buildLandingPage } from '../tools/index.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { SocialPlatform } from '../../../types/social.js'

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSection = (relativePath: string): string => readFileSync(join(skillRoot, relativePath), 'utf8')

const enabledContext = { metadata: { marketingCampaignsEnabled: true, appId: 'app1234567' } }
const disabledContext = { metadata: { marketingCampaignsEnabled: false, appId: 'app1234567' } }

const samplePlan = {
  name: 'Summer Sale',
  offer: '20% off everything',
  startDate: '2026-07-01',
  endDate: '2026-07-07',
  campaignType: 'landing-page' as const,
  landingPagePath: '/Summer Sale',
  assets: [{ assetType: 'social' as const, title: 'Teaser post' }],
  assumptions: ['Your audience is collectors', 'Your main goal is sales'],
  whyThisMix: 'The landing page gives buyers one place to land and buy.',
  expectation: 'A small first wave of visitors and a handful of early sales.',
}

const run = (tool: typeof campaignPlanPropose, input: unknown, context: unknown): Promise<any> =>
  (tool.execute as (i: unknown, c: unknown) => Promise<any>)(input, context)

describe('marketing-campaigns orchestrator tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ success: true, exists: false })
    mockSet.mockResolvedValue({ success: true })
  })

  describe('campaignPlanPropose (PLAN phase gate)', () => {
    it('stops the agent after running so the user can approve', () => {
      expect(campaignPlanPropose.config?.stopAfter).toBe(true)
    })

    it('returns an error when the feature flag is off', async () => {
      const result = await run(campaignPlanPropose, samplePlan, disabledContext)
      expect(result).toEqual({ success: false, error: 'Marketing campaigns are not available.' })
    })

    it('renders the plan-propose widget with the plan when enabled', async () => {
      const result = await run(campaignPlanPropose, samplePlan, enabledContext)
      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('campaign-plan-propose')
      expect(result.widgetData.plan.name).toBe('Summer Sale')
      expect(result.widgetData.plan.assets).toHaveLength(1)
      // structured education fields are passed through to the card (deterministic, not prose-dependent)
      expect(result.widgetData.plan.assumptions).toEqual(['Your audience is collectors', 'Your main goal is sales'])
      expect(result.widgetData.plan.whyThisMix).toMatch(/one place to land and buy/i)
      expect(result.widgetData.plan.expectation).toMatch(/small first wave/i)
    })

    it('sanitizes the slug at plan time and returns canonical landingPageSlug + route', async () => {
      const result = await run(campaignPlanPropose, { ...samplePlan, landingPagePath: '/Summer Sale' }, enabledContext)
      expect(result.widgetData.plan.landingPageSlug).toBe('summer-sale')
      expect(result.widgetData.plan.landingPageRoute).toBe('/lp/summer-sale')
    })

    it('sanitizes a digit-leading slug at plan time', async () => {
      const result = await run(campaignPlanPropose, { ...samplePlan, landingPagePath: '2024-deal' }, enabledContext)
      expect(result.widgetData.plan.landingPageSlug).toBe('2024-deal')
      expect(result.widgetData.plan.landingPageRoute).toBe('/lp/2024-deal')
    })
  })

  describe('campaignPlanPropose brand-signal persist (empty-only side effect)', () => {
    const signalPlan = { ...samplePlan, vertical: 'coffee roaster', salesType: 'in_store' as const, location: '123 Main St, Austin TX' }

    it('persists vertical/salesType/location to brand.identity when the brand book is empty', async () => {
      mockGet.mockResolvedValue({ success: true, exists: false })

      await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(mockSet).toHaveBeenCalledWith(expect.anything(), 'brand.identity', expect.objectContaining({
        vertical: 'coffee roaster',
        salesType: 'in_store',
        location: '123 Main St, Austin TX',
      }))
    })

    it('never overwrites a field that is already stored', async () => {
      mockGet.mockResolvedValue({ success: true, exists: true, value: { vertical: 'law firm' } })

      await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(mockSet).toHaveBeenCalledTimes(1)
      const written = mockSet.mock.calls[0][2]
      // existing vertical preserved, only the missing fields filled
      expect(written.vertical).toBe('law firm')
      expect(written.salesType).toBe('in_store')
      expect(written.location).toBe('123 Main St, Austin TX')
    })

    it('does not call set when every signal field is already present', async () => {
      mockGet.mockResolvedValue({
        success: true,
        exists: true,
        value: { vertical: 'law firm', salesType: 'service', location: 'Austin' },
      })

      await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(mockSet).not.toHaveBeenCalled()
    })

    it('does not touch the store when no signal args are provided', async () => {
      await run(campaignPlanPropose, samplePlan, enabledContext)

      expect(mockGet).not.toHaveBeenCalled()
      expect(mockSet).not.toHaveBeenCalled()
    })

    it('still returns the campaign-plan-propose widget unchanged when persisting', async () => {
      const result = await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('campaign-plan-propose')
      expect(result.widgetData.plan.name).toBe('Summer Sale')
      // signal fields are NOT leaked into the rendered plan
      expect(result.widgetData.plan.vertical).toBeUndefined()
      expect(result.widgetData.plan.salesType).toBeUndefined()
      expect(result.widgetData.plan.location).toBeUndefined()
    })

    it('does not break the tool when the store read fails', async () => {
      mockGet.mockResolvedValue({ success: false, exists: false, error: 'boom' })

      const result = await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(mockSet).not.toHaveBeenCalled()
      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('campaign-plan-propose')
    })

    it('does not break the tool when the store throws', async () => {
      mockGet.mockRejectedValue(new Error('kaboom'))

      const result = await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('campaign-plan-propose')
    })

    it('does not break the tool when the store write reports failure', async () => {
      mockGet.mockResolvedValue({ success: true, exists: false })
      mockSet.mockResolvedValue({ success: false, error: 'disk full' })

      const result = await run(campaignPlanPropose, signalPlan, enabledContext)

      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(result.widgetType).toBe('campaign-plan-propose')
    })
  })

  describe('feature gating', () => {
    it('campaignPlanCreate is gated behind the flag', async () => {
      const result = await run(campaignPlanCreate, { ...samplePlan, plannedContent: [] }, disabledContext)
      expect(result).toEqual({ success: false, error: 'Marketing campaigns are not available.' })
    })

    it('campaignCreate is gated behind the flag', async () => {
      const result = await run(campaignCreate, { ...samplePlan, assets: [] }, disabledContext)
      expect(result).toEqual({ success: false, error: 'Marketing campaigns are not available.' })
    })
  })

  it('exports exactly the four orchestrator tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      'campaignPlanPropose',
      'campaignScaffoldPage',
      'campaignPlanCreate',
      'campaignCreate',
    ])
  })
})

describe('marketing-campaigns orchestration contract', () => {
  it('CLARIFY always asks promoting + goal, asks the vertical when missing, but never channels/dates/name/sales-mode/location', () => {
    const clarify = readSection('templates/sections/01-clarify.md')
    // Assert against the askQuestion code block so the prose (which legitimately
    // mentions "name"/"channels" in prohibitions) does not give a false pass.
    const example = clarify.match(/```javascript[\s\S]*?```/)?.[0] ?? ''
    // the two core questions are always present
    expect(example).toMatch(/promoting/i)
    // the vertical IS asked when missing (inferred from the site, not stored/retrieved via any tool)
    expect(example).toMatch(/what kind of business/i)       // → vertical
    expect(example).toMatch(/INCLUDE ONLY IF MISSING/i)     // conditional — drop if already known
    // brand-identity fields were removed — sales mode + location are NOT asked
    expect(example).not.toMatch(/how do customers buy/i)    // salesType is not asked up front
    expect(example).not.toMatch(/where do you sell or serve/i) // location — never asked
    // these stay proposed by the AI, NEVER asked
    expect(example).not.toMatch(/channel/i)  // channel mix is proposed in PLAN
    expect(example).not.toMatch(/\bname\b/i) // the campaign name is proposed, never asked
    // prose: single call, ask the vertical only if missing, never duration/channels
    expect(clarify).toMatch(/SINGLE askQuestion call/i)
    expect(clarify).toMatch(/ONLY if it's NOT already known/i)
    expect(clarify).toMatch(/how long should the campaign run/i) // duration is proposed, never asked
    expect(clarify).toMatch(/PROPOSES the campaign name, the dates/i)
    expect(clarify).toMatch(/Do NOT ask the user to pick channels/i)
    expect(clarify).toMatch(/recommended in the PLAN/i)
  })

  it('PLAN instructs the AI to choose the channel mix with a rationale', () => {
    const plan = readSection('templates/sections/02-plan.md')
    expect(plan).toMatch(/Choose the channel mix/i)
    expect(plan).toMatch(/each channel serves their goal/i)
  })

  it('PLAN proposes name + dates (date-aware) and frames around outcomes', () => {
    const plan = readSection('templates/sections/02-plan.md')
    expect(plan).toMatch(/propose everything else/i)
    expect(plan).toMatch(/be date-aware/i)
    expect(plan).toMatch(/why marketing it this way matters/i)
    expect(plan).toMatch(/Why each piece — tie every asset to the goal/i) // per-asset "why" that educates the owner
  })

  it('PLAN surfaces assumptions and invites correction before the plan card', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/What I understood about your business/i)
    expect(plan).toMatch(/tell me if any of this is off/i)
    expect(skill).toMatch(/Never leave the .assumptions. field empty/i)
  })

  it('PLAN gives a directional expectation but forbids precise fabricated figures', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/rough, directional/i)
    expect(plan).toMatch(/never precise figures or guarantees/i)
    expect(plan).toMatch(/as if they were projections/i)
    expect(skill).toMatch(/Never present precise performance numbers/i)
  })

  it('PLAN educates conversationally and includes a plain-language checklist', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/Educating clearly matters more than being terse/i)
    expect(plan).toMatch(/A quick checklist — in plain terms/i)
    expect(plan).toMatch(/goes live when you launch/i)
    expect(plan).toMatch(/NOT a `todoList`/i) // conversational recap, not a todo list
    expect(skill).toMatch(/plain-language checklist of what they're getting/i)
  })

  it('landing page is mandatory in every plan (counts are the AI call)', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/landing page is ALWAYS in the plan/i)
    expect(plan).toMatch(/mandatory channel/i)
    expect(skill).toMatch(/landing page is ALWAYS in the plan/i)
  })

  it('skill flow marks channels as recommended in PLAN, not asked in CLARIFY', () => {
    const skill = readSection('skill.md')
    expect(skill).toMatch(/NEVER ask which channels/i)
    expect(skill).toMatch(/AI recommends the optimal channel mix/i)
  })

  it('skill forbids the upfront channel question but allows post-plan channel changes', () => {
    const skill = readSection('skill.md')
    expect(skill).toMatch(/NEVER ask the user to choose channels before the first plan/i)
    // carve-out: channel edits AFTER the plan is proposed must stay allowed (revision loop)
    expect(skill).toMatch(/RE-ENTRY AFTER PLAN CHANGES/i)
    expect(skill).toMatch(/does NOT restrict channel changes AFTER the plan is proposed/i)
  })

  it('VERIFY auto-handles blog setup, flags customer-only prereqs, SUMMARY surfaces pending actions', () => {
    const verify = readSection('templates/sections/03-verify.md')
    const generate = readSection('templates/sections/04-generate.md')
    const summary = readSection('templates/sections/05-summary.md')
    expect(generate).toMatch(/blog index\/listing page/i) // agent sets up a discoverable blog system
    expect(verify).toMatch(/PENDING CUSTOMER ACTION/i) // social connection recorded, not silently ignored
    expect(verify).toMatch(/AGENT sets up automatically/i) // blog is agent-doable, not a customer ask
    expect(summary).toMatch(/pending action/i) // surfaced by the Launch button
  })

  it('GENERATE creates social posts BEFORE the build handoff (social tool lives on marketing)', () => {
    const generate = readSection('templates/sections/04-generate.md')
    expect(generate).toMatch(/Social posts.*do this FIRST/is)
    expect(generate).toMatch(/do this LAST/i) // build handoff is last
    expect(generate).toMatch(/NEVER hand off to build before the social posts exist/i)
  })

  it('persists the business signal via campaignPlanPropose, never via appPlan', () => {
    const generate = readSection('templates/sections/04-generate.md')
    const skill = readSection('skill.md')
    // vertical/salesType/location are persisted to the brand book as a side effect of
    // campaignPlanPropose (a gate-enforced call), NOT a separate model-initiated set —
    // a separate set loses to the PLAN gate, so the signal never landed before.
    expect(skill).toMatch(/campaignPlanPropose/i)
    expect(skill).toMatch(/vertical/i)
    expect(skill).toMatch(/salesType/)
    expect(skill).toMatch(/brand book/i)
    // the legacy appPlan path is gone everywhere
    expect(generate).not.toMatch(/appPlan/)
    expect(skill).not.toMatch(/appPlan/)
    // CLARIFY reads the stored values back so a later campaign doesn't re-ask
    const clarify = readSection('templates/sections/01-clarify.md')
    expect(clarify).toMatch(/brandIdentity/)
    expect(clarify).not.toMatch(/appPlan/)
  })

  it('SUMMARY never claims the campaign is live/launched and keeps asset status honest', () => {
    const summary = readSection('templates/sections/05-summary.md')
    // campaign-level honesty: built/ready, never "live"/"launched" — for the campaign OR its assets
    expect(summary).toMatch(/Never say the campaign OR any of its assets/i)
    expect(summary).toMatch(/built and ready to launch/i)
    // the example template must not model "live on your site/blog" wording (the model copied it)
    expect(summary).not.toMatch(/live on your (site|blog)/i)
    // per-asset status honesty: nothing is 'published'/'sent' at summary time
    expect(summary).toMatch(/Set .*status.* honestly/i)
    expect(summary).toMatch(/never use .*published.* or .*sent/i)
  })

  it('skill.md routes PLAN education into structured tool fields + keeps SUMMARY honesty', () => {
    const skill = readSection('skill.md')
    // education lives in REQUIRED tool fields the card renders (reliable), not prose the model may skip
    expect(skill).toMatch(/fill the education fields on the tool call/i)
    expect(skill).toMatch(/REQUIRED education fields/i)
    expect(skill).toMatch(/`assumptions`/)
    expect(skill).toMatch(/`whyThisMix`/)
    expect(skill).toMatch(/`expectation`/)
    expect(skill).toMatch(/populate every field/i)
    // SUMMARY honesty unchanged
    expect(skill).toMatch(/NEVER say the campaign or any asset is "live", "launched", or "published"/i)
    expect(skill).toMatch(/built and ready to launch/i)
  })

  it('skill.md (the only model-visible file) carries the concrete VERIFY prereq checks before generation', () => {
    const skill = readSection('skill.md')
    // The model only ever sees skill.md — section files like 03-verify.md are never surfaced.
    // The executable prereq checks must therefore live in skill.md, not only in the section file.
    expect(skill).toMatch(/VERIFY — check prerequisites BEFORE generating/i)
    expect(skill).toMatch(/socialRead\(\{ platform: 'FACEBOOK' \}\)/)
    expect(skill).toMatch(/socialRead\(\{ platform: 'INSTAGRAM' \}\)/)
    expect(skill).toMatch(/directoryListing\(\{ path: 'src\/content\/data\/blog' \}\)/)
    // customer-only (social connect) vs agent-doable (blog setup) distinction must be explicit
    expect(skill).toMatch(/CUSTOMER action/)
    expect(skill).toMatch(/AGENT.*task/i)
    // never block generation; carry pending actions into SUMMARY
    expect(skill).toMatch(/pending customer action/i)
  })

  it('marketing-campaigns is pinned to the marketing agent (skill relies on marketing-only tools)', () => {
    const skill = readSection('skill.md')
    // allowedAgents keeps the skill off DevelopAgent's menu so it is never half-loaded
    // without socialPostCreate; campaign requests route to marketing via develop/handoff.md.
    expect(skill).toMatch(/allowedAgents:\s*\[marketing\]/)
  })

  it('all five phase sections exist', () => {
    for (const section of ['01-clarify', '02-plan', '03-verify', '04-generate', '05-summary']) {
      expect(() => readSection(`templates/sections/${section}.md`)).not.toThrow()
    }
  })
})

describe('campaignPlanCreate social-connection prerequisite (deterministic)', () => {
  beforeEach(() => {
    mockSocialFindByAppId.mockReset()
  })

  const planWithAssets = (assets: Array<Record<string, unknown>>): Record<string, unknown> => ({
    name: 'Summer Sale',
    offer: '20% off',
    startDate: '2026-07-01',
    endDate: '2026-07-07',
    plannedContent: assets,
  })

  it('no social assets → socialConnected undefined, no pendingActions, repo never queried', async () => {
    const result = await run(
      campaignPlanCreate,
      planWithAssets([{ assetType: 'blog', title: 'Buyer guide', imageUrl: 'https://example.com/img.png' }]),
      enabledContext,
    )
    expect(result.socialConnected).toBeUndefined()
    expect(result.pendingActions).toEqual([])
    expect(mockSocialFindByAppId).not.toHaveBeenCalled()
  })

  it('social asset + a connected platform → socialConnected true, no pendingActions', async () => {
    mockSocialFindByAppId.mockReturnValue([{ platform: SocialPlatform.FACEBOOK }])
    const result = await run(
      campaignPlanCreate,
      planWithAssets([{ assetType: 'social', title: 'Teaser post', imageUrl: 'https://example.com/img.png' }]),
      enabledContext,
    )
    expect(result.socialConnected).toBe(true)
    expect(result.pendingActions).toEqual([])
  })

  it('social asset + no connection → socialConnected false, one connect pendingAction', async () => {
    mockSocialFindByAppId.mockReturnValue([])
    const result = await run(
      campaignPlanCreate,
      planWithAssets([{ assetType: 'social', title: 'Teaser post', imageUrl: 'https://example.com/img.png' }]),
      enabledContext,
    )
    expect(result.socialConnected).toBe(false)
    expect(result.pendingActions).toHaveLength(1)
    expect(result.pendingActions[0]).toMatch(/Connect Facebook\/Instagram/)
  })
})

describe('sanitizeSlug', () => {
  it("keeps a clean slug ('summer-sale')", () => {
    expect(sanitizeSlug('summer-sale')).toBe('summer-sale')
  })

  it("keeps a digit-leading slug ('2024-deal') — no digit-prefix here", () => {
    expect(sanitizeSlug('2024-deal')).toBe('2024-deal')
  })

  it("takes the last path segment ('sale/summer' -> 'summer')", () => {
    expect(sanitizeSlug('sale/summer')).toBe('summer')
  })

  it("lowercases and replaces non [a-z0-9-] (\"O'Brien's Sale\" -> 'o-brien-s-sale')", () => {
    expect(sanitizeSlug("O'Brien's Sale")).toBe('o-brien-s-sale')
  })

  it("strips a leading slash ('/leading-slash' -> 'leading-slash')", () => {
    expect(sanitizeSlug('/leading-slash')).toBe('leading-slash')
  })

  it("falls back to 'campaign' when empty ('!!!' -> 'campaign')", () => {
    expect(sanitizeSlug('!!!')).toBe('campaign')
  })
})

describe('buildLandingPage', () => {
  it('injects dates via JSON.stringify and derives the component name', async () => {
    const result = await buildLandingPage('summer-sale', '2026-07-01', '2026-07-07')
    expect(result).toContain(JSON.stringify('2026-07-01T00:00:00Z'))
    expect(result).toContain(JSON.stringify('2026-07-07T23:59:59Z'))
    // Component name is PascalCase from the slug + 'Page'.
    expect(result).toContain('SummerSalePage')
  })

  it("digit-prefixes the component name ('2024-deal' -> 'C2024DealPage')", async () => {
    const result = await buildLandingPage('2024-deal', '2026-07-01', '2026-07-07')
    expect(result).toContain('C2024DealPage')
  })
})

describe('campaignScaffoldPage scaffold behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the disabled error when the feature flag is off', async () => {
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, disabledContext)
    expect(result).toEqual({ success: false, error: 'Marketing campaigns are not available.' })
  })

  it('returns success:false with no files when the workspace is unavailable', async () => {
    vi.mocked(createForWorkspace).mockReturnValue(null as any)
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)
    expect(result.success).toBe(false)
    expect(result.filesWritten).toEqual([])
  })

  it('returns success:false with no files when the write throws', async () => {
    vi.mocked(createForWorkspace).mockReturnValue({
      files: { write: vi.fn().mockRejectedValue(new Error('disk full')) },
    } as any)
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)
    expect(result.success).toBe(false)
    expect(result.filesWritten).toEqual([])
  })

  it('returns success:true and writes the page when the write resolves', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createForWorkspace).mockReturnValue({ files: { write } } as any)
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)
    expect(result.success).toBe(true)
    expect(result.filesWritten).toEqual(['src/pages/lp/summer-sale.tsx'])
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/pages/lp/summer-sale.tsx' }))
  })
})
