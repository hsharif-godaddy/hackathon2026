import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DevSupervisorError } from '../../../services/DevSupervisorClient.js'

const notFound = () => { throw new DevSupervisorError('not_found', 404, 'file not found') }

// Stable mocks for the KV memory store backing the brand-signal persist side effect.
const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}))

const { mockMediaSearch, mockSocialPostRepo, mockMarketingUtmRepo } = vi.hoisted(() => ({
  mockMediaSearch: {
    searchMedia: vi.fn().mockResolvedValue({ success: false }),
  },
  mockSocialPostRepo: {
    create: vi.fn().mockReturnValue({ id: 'post-mat1' }),
    update: vi.fn(),
  },
  mockMarketingUtmRepo: {
    create: vi.fn(),
  },
}))

vi.mock('../../../memory/adapters/index.js', () => ({
  getKvMemoryStore: () => ({ get: mockGet, set: mockSet }),
}))
vi.mock('../../../memory/interfaces/scope.js', () => ({
  workspaceScopeFromAppId: vi.fn(() => ({ scope: 'test' })),
  customerIdFromContext: vi.fn(() => undefined),
}))
vi.mock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn() }))
vi.mock('../../../tools/media-search-tool.js', () => ({
  MediaSearchTool: vi.fn(function () { return mockMediaSearch }),
}))
vi.mock('../../../database/repositories/SocialPostRepository.js', () => ({
  SocialPostRepository: vi.fn(function () { return mockSocialPostRepo }),
}))
vi.mock('../../../database/repositories/MarketingUtmRepository.js', () => ({
  MarketingUtmRepository: vi.fn(function () { return mockMarketingUtmRepo }),
}))

// Blog-UTM tool deps: stub the published-URL resolver and the marketing_utm-minting half of
// the decorator (decorateBlogCta), but keep decorateConversionCtaLinks REAL so the test
// exercises the actual markdown rewrite + same-domain skip.
const { mockResolvePublishedUrl, mockDecorateBlogCta, mockDecorateSocialCta } = vi.hoisted(() => ({
  mockResolvePublishedUrl: vi.fn(),
  mockDecorateBlogCta: vi.fn(),
  mockDecorateSocialCta: vi.fn(),
}))
vi.mock('../../../services/site-published-url.js', () => ({
  resolvePublishedUrlFromToolContext: (...args: unknown[]): unknown => mockResolvePublishedUrl(...args),
}))
vi.mock('../../../services/campaign-link-decorator.js', async (importOriginal): Promise<Record<string, unknown>> => {
  const actual = await importOriginal<typeof import('../../../services/campaign-link-decorator.js')>()
  return {
    ...actual,
    decorateBlogCta: (...args: unknown[]): unknown => mockDecorateBlogCta(...args),
    decorateSocialCta: (...args: unknown[]): unknown => mockDecorateSocialCta(...args),
  }
})

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

import { tools, campaignPlanPropose, campaignPlanCreate, campaignCreate, campaignScaffoldPage, campaignApplyBlogUtm, sanitizeSlug, buildLandingPage, setFrontmatterField, frontmatterId } from '../tools/index.js'
import { createForWorkspace } from '../../../workspace/index.js'
import { createStubWorkspaceFiles } from '../../../workspace/__tests__/test-workspace-files.js'
import { setLandingPages, getPageBySlug, getPageById, getAllPages } from '../templates/lib/landing-pages.js'
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

  it('exports exactly the orchestrator tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      'campaignPlanPropose',
      'campaignScaffoldPage',
      'campaignPlanCreate',
      'campaignCreate',
      'campaignApplyBlogUtm',
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

  it('GENERATE creates social posts BEFORE the build, builds directly, and never hands off or names an agent', () => {
    const generate = readSection('templates/sections/04-generate.md')
    const skill = readSection('skill.md')
    // The model reads tool descriptions and execute() return messages too, so a
    // "builder"/handoff reference in the tool source leaks just like one in the prompt.
    const tools = readSection('tools/index.ts')
    expect(generate).toMatch(/Social posts.*do this FIRST/is)
    expect(generate).toMatch(/do this LAST/i)
    expect(generate).toMatch(/NEVER build before the social posts exist/i)
    // "build"/"building" verbs are allowed — the \bbuilder\b boundary catches only the agent noun.
    const agentRefs: RegExp = /hand[- ]?off|DevelopAgent|marketing agent|\bbuilder\b/i
    const surfaces: Record<string, string> = {
      'skill.md': skill,
      'tools/index.ts': tools,
      '01-clarify.md': readSection('templates/sections/01-clarify.md'),
      '02-plan.md': readSection('templates/sections/02-plan.md'),
      '03-verify.md': readSection('templates/sections/03-verify.md'),
      '04-generate.md': generate,
      '05-summary.md': readSection('templates/sections/05-summary.md'),
    }
    for (const [name, content] of Object.entries(surfaces)) {
      expect(content, `${name} leaks an agent/handoff reference`).not.toMatch(agentRefs)
    }
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
    // per-asset status honesty: status is system-owned and every asset is a draft pre-launch,
    // so the summary never models a 'scheduled'/'published' status the customer hasn't earned
    expect(summary).toMatch(/status is system-owned/i)
    expect(summary).toMatch(/persists every asset as .*draft/i)
    expect(summary).toMatch(/nothing is scheduled or published/i)
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
    expect(skill).toMatch(/NEVER say the campaign or any asset is "live", "launched", "published", "up", or "reachable"/i)
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

  it('marketing-campaigns is available to the develop agent', () => {
    const skill = readSection('skill.md')
    // develop must be in allowedAgents or the skill-loader gate hides it.
    // The marketing agent was removed — develop owns marketing end-to-end.
    expect(skill).toMatch(/allowedAgents:\s*\[\s*develop\s*\]/)
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

const parse = <T extends { parameters: z.ZodTypeAny }>(tool: T, input: unknown): z.infer<T['parameters']> =>
  tool.parameters.parse(input)

describe('jsonArray preprocess — LLM double-encoded string inputs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue({ success: true, exists: false })
    mockSet.mockResolvedValue({ success: true })
    mockCampaignFindByAppId.mockReturnValue([])
    mockCampaignCreate.mockReturnValue({ id: 'camp_x' })
    mockCampaignTransition.mockReturnValue({ id: 'camp_x', status: 'ready' })
    mockMediaSearch.searchMedia.mockResolvedValue({ success: false })
    mockSocialFindByAppId.mockReturnValue([])
  })

  it('campaignPlanPropose accepts assets as a JSON-encoded string', async () => {
    const parsed: z.infer<typeof campaignPlanPropose['parameters']> = parse(campaignPlanPropose, {
      ...samplePlan,
      assets: JSON.stringify([{ assetType: 'social', title: 'Teaser post' }]),
    })
    const result = await run(campaignPlanPropose, parsed, enabledContext)
    expect(result.success).toBe(true)
    expect(result.widgetData.plan.assets).toHaveLength(1)
  })

  it('campaignPlanPropose accepts assumptions as a JSON-encoded string', async () => {
    const parsed: z.infer<typeof campaignPlanPropose['parameters']> = parse(campaignPlanPropose, {
      ...samplePlan,
      assumptions: JSON.stringify(['Your audience is collectors', 'Your main goal is sales']),
    })
    const result = await run(campaignPlanPropose, parsed, enabledContext)
    expect(result.success).toBe(true)
    expect(result.widgetData.plan.assumptions).toHaveLength(2)
  })

  it('campaignPlanPropose accepts a native array without modification', () => {
    const assets: z.infer<typeof campaignPlanPropose['parameters']>['assets'] = [{ assetType: 'social', title: 'Teaser post' }]
    const parsed: z.infer<typeof campaignPlanPropose['parameters']> = parse(campaignPlanPropose, { ...samplePlan, assets })
    expect(parsed.assets).toEqual(assets)
  })

  it('campaignPlanPropose rejects malformed JSON with a ZodError', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assets: '[not json' })).toThrow(z.ZodError)
  })

  it('campaignPlanPropose rejects a JSON-encoded non-array with a ZodError', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assets: '{}' })).toThrow(z.ZodError)
  })

  it('campaignPlanPropose rejects an empty JSON-encoded array with a ZodError (min(1))', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assets: '[]' })).toThrow(z.ZodError)
  })

  it('campaignPlanPropose rejects malformed JSON in assumptions with a ZodError', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assumptions: '[not json' })).toThrow(z.ZodError)
  })

  it('campaignPlanPropose rejects a JSON-encoded non-array for assumptions with a ZodError', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assumptions: '{}' })).toThrow(z.ZodError)
  })

  it('campaignPlanPropose rejects an empty JSON-encoded array for assumptions with a ZodError (min(1))', () => {
    expect(() => parse(campaignPlanPropose, { ...samplePlan, assumptions: '[]' })).toThrow(z.ZodError)
  })

  it('campaignApplyBlogUtm accepts blogPosts as a JSON-encoded string', () => {
    const parsed: z.infer<typeof campaignApplyBlogUtm['parameters']> = parse(campaignApplyBlogUtm, {
      landingPageSlug: 'summer-sale',
      blogPosts: JSON.stringify([{ slug: 'baking-tips', topicSlug: 'baking' }]),
    })
    expect(parsed.blogPosts).toHaveLength(1)
    expect(parsed.blogPosts[0].slug).toBe('baking-tips')
  })

  it('campaignPlanCreate accepts plannedContent as a JSON-encoded string', async () => {
    const raw: z.infer<typeof campaignPlanCreate['parameters']> = parse(campaignPlanCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: JSON.stringify([{ assetType: 'blog', title: 'SEO post', status: 'scheduled', imageUrl: 'http://img' }]),
    })
    const result = await run(campaignPlanCreate, raw, enabledContext)
    expect(result.success).toBe(true)
    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'blog' }))
  })

  it('campaignCreate accepts assets as a JSON-encoded string', async () => {
    const raw: z.infer<typeof campaignCreate['parameters']> = parse(campaignCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      assets: JSON.stringify([{ assetType: 'blog', externalRef: 'src/content/blog/post.md', title: 'SEO post' }]),
    })
    const result = await run(campaignCreate, raw, enabledContext)
    expect(result.success).toBe(true)
    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'blog' }))
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
  it('derives the PascalCase component name from the slug and accepts date props at runtime', async () => {
    const result = await buildLandingPage('summer-sale')
    // Dates are no longer injected at scaffold time — they come from the manifest at runtime.
    expect(result).not.toContain('__SALE_START__')
    expect(result).not.toContain('__SALE_END__')
    expect(result).toContain('SummerSalePage')
    expect(result).toContain('startDate')
    expect(result).toContain('endDate')
  })

  it("digit-prefixes the component name ('2024-deal' -> 'C2024DealPage')", async () => {
    const result = await buildLandingPage('2024-deal')
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
      files: createStubWorkspaceFiles({ write: vi.fn().mockRejectedValue(new Error('disk full')), readText: vi.fn().mockResolvedValue('') }),
    } as any)
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)
    expect(result.success).toBe(false)
    expect(result.filesWritten).toEqual([])
  })

  it('writes the per-campaign TSX + manifest, wires the route, and returns a stable pageId', async () => {
    const ROUTES_CONTENT = [
      "import { RouteObject } from 'react-router-dom';",
      "import HomePage from './pages/index';",
      'export const routes: RouteObject[] = [',
      "  { path: '/', element: <HomePage /> },",
      "  { path: '*', element: <NotFoundPage /> },",
      '];',
    ].join('\n')

    const write = vi.fn().mockResolvedValue(undefined)
    const readText = vi.fn(async ({ path }: { path: string }): Promise<string> => {
      if (path === 'src/content/data/landingPages.json') return '[]';
      if (path === 'src/routes.tsx') return ROUTES_CONTENT;
      notFound();
      return '';
    });
    const view = vi.fn(async ({ path }: { path: string }) => {
      if (path === 'src/content/data/landingPages.json') return { content: '[]' }
      if (path === 'src/routes.tsx') return { content: ROUTES_CONTENT }
      notFound()
    })
    vi.mocked(createForWorkspace).mockReturnValue({ files: createStubWorkspaceFiles({ write, view, readText }) } as any)
    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)

    expect(result.success).toBe(true)
    expect(result.pageId).toMatch(/^lp-[0-9a-z]{12}$/)
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/pages/lp/summer-sale.tsx' }),
    )
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/content/data/landingPages.json' }),
    )
    // The route was injected into routes.tsx before the catch-all.
    const routesWrite = write.mock.calls
      .map(([arg]) => arg)
      .find((arg: any) => arg.path === 'src/routes.tsx')
    expect(routesWrite).toBeDefined()
    expect(routesWrite.content).toContain("{ path: '/lp/:slug', element: <LandingPage /> },")
    expect(routesWrite.content).toContain("import LandingPage from './pages/lp';")
  })

  it('returns success:false and flags manual wiring when the route cannot be wired', async () => {
    // routes.tsx has no catch-all `path: '*'` entry to anchor to, so route wiring
    // fails even though the TSX + manifest writes succeed.
    const ROUTES_CONTENT_NO_CATCH_ALL = [
      "import { RouteObject } from 'react-router-dom';",
      "import HomePage from './pages/index';",
      'export const routes: RouteObject[] = [',
      "  { path: '/', element: <HomePage /> },",
      '];',
    ].join('\n')

    const write = vi.fn().mockResolvedValue(undefined)
    const readText = vi.fn(async ({ path }: { path: string }): Promise<string> => {
      if (path === 'src/content/data/landingPages.json') return '[]';
      if (path === 'src/routes.tsx') return ROUTES_CONTENT_NO_CATCH_ALL;
      notFound();
      return '';
    });
    const view = vi.fn(async ({ path }: { path: string }) => {
      if (path === 'src/content/data/landingPages.json') return { content: '[]' }
      if (path === 'src/routes.tsx') return { content: ROUTES_CONTENT_NO_CATCH_ALL }
      notFound()
    })
    vi.mocked(createForWorkspace).mockReturnValue({ files: createStubWorkspaceFiles({ write, view, readText }) } as any)

    const result = await run(campaignScaffoldPage, {
      startDate: '2026-07-01',
      endDate: '2026-07-07',
      landingPagePath: '/summer-sale',
    }, enabledContext)

    // The TSX + manifest were written, but the route could not be wired.
    expect(result.success).toBe(false)
    expect(result.routeStatus).toBe('failed')
    expect(result.filesWritten).toContain('src/pages/lp/summer-sale.tsx')
    expect(result.filesWritten).toContain('src/content/data/landingPages.json')
    expect(result.filesWritten).not.toContain('src/routes.tsx')
    expect(result.message).toContain('src/routes.tsx')
    expect(result.message.toLowerCase()).toContain('manual')
  })
})

describe('landing-pages render-time gate', () => {
  const past = '2020-01-01T00:00:00Z'
  const pastEnd = '2020-01-07T00:00:00Z'
  const future = '2999-01-01T00:00:00Z'
  const futureEnd = '2999-01-07T00:00:00Z'

  beforeEach(() => setLandingPages([]))

  it('getPageBySlug returns null for a draft entry', () => {
    setLandingPages([{ id: 'page-aaaaaaaaaaaa', slug: 'draft-page', startDate: past, endDate: pastEnd, status: 'draft' }])
    expect(getPageBySlug('draft-page')).toBeNull()
  })

  it('getPageBySlug returns a published-but-future entry (page handles coming-soon state)', () => {
    setLandingPages([{ id: 'page-bbbbbbbbbbbb', slug: 'future-page', startDate: future, endDate: futureEnd, status: 'scheduled' }])
    expect(getPageBySlug('future-page')?.slug).toBe('future-page')
  })

  it('getPageBySlug returns a published entry with a past startDate', () => {
    setLandingPages([{ id: 'page-cccccccccccc', slug: 'live-page', startDate: past, endDate: pastEnd, status: 'published' }])
    expect(getPageBySlug('live-page')?.slug).toBe('live-page')
  })

  it('getPageById returns a draft entry (ungated)', () => {
    setLandingPages([{ id: 'page-dddddddddddd', slug: 'draft-page', startDate: future, endDate: futureEnd, status: 'draft' }])
    expect(getPageById('page-dddddddddddd')?.id).toBe('page-dddddddddddd')
  })

  it('getAllPages excludes ONLY drafts (scheduled/future-dated included)', () => {
    setLandingPages([
      { id: 'page-1', slug: 'live', startDate: past, endDate: pastEnd, status: 'published' },
      { id: 'page-2', slug: 'draft', startDate: past, endDate: pastEnd, status: 'draft' },
      { id: 'page-3', slug: 'future', startDate: future, endDate: futureEnd, status: 'scheduled' },
    ])
    expect(getAllPages().map(p => p.slug)).toEqual(['live', 'future'])
  })
})

describe('campaignPlanCreate persists social raw_content', () => {
  beforeEach(() => {
    mockCampaignFindByAppId.mockReturnValue([])
    mockCampaignCreate.mockReturnValue({ id: 'camp_x' })
    mockCampaignTransition.mockReturnValue({ id: 'camp_x', status: 'ready' })
    mockMediaSearch.searchMedia.mockResolvedValue({ success: false })
    mockSocialPostRepo.create.mockReturnValue({ id: 'post-mat1' })
    mockMarketingUtmRepo.create.mockReset()
  })

  it('writes raw_content and status=draft for a social asset', async () => {
    await run(campaignPlanCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{
        assetType: 'social', title: 'Launch post', scheduledDate: '2026-07-02', imageUrl: 'http://img',
        rawContent: { message: 'Spring sale!', hashtags: ['spring'], callToAction: 'Shop', platform: 'facebook' },
      }],
    }, enabledContext)

    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'social',
      status: 'draft',
      rawContent: expect.stringContaining('"message":"Spring sale!"'),
    }))
  })

  it('forces non-social assets to draft and leaves raw_content unset when no slug is given', async () => {
    await run(campaignPlanCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{ assetType: 'blog', title: 'SEO post', status: 'scheduled', imageUrl: 'http://img' }],
    }, enabledContext)

    // Status is system-owned pre-launch: the 'scheduled' the caller passed is overridden to 'draft'.
    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'blog', status: 'draft' }))
    // No slug -> no .md located -> raw_content stays unset.
    expect(mockCampaignAddContent.mock.calls[0][0].rawContent).toBeUndefined()
  })

  it('defaults a social asset with no rawContent to status=draft and writes no raw_content', async () => {
    await run(campaignPlanCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{ assetType: 'social', title: 'Teaser', imageUrl: 'http://img' }],
    }, enabledContext)

    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'social', status: 'draft' }))
    expect(mockCampaignAddContent.mock.calls[0][0].rawContent).toBeUndefined()
    expect(mockSocialPostRepo.create).not.toHaveBeenCalled()
    expect(mockCampaignAddContent.mock.calls[0][0].contentRefId).toBeUndefined()
  })

  it('materializes a DRAFT social_posts carrier (no UTM) and stamps contentRefId for a social asset', async () => {
    await run(campaignPlanCreate, {
      name: 'Spring', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{
        assetType: 'social', title: 'Launch post', scheduledDate: '2026-07-02', imageUrl: 'http://img',
        rawContent: { message: 'Spring sale!', hashtags: ['spring'], callToAction: 'Shop', platform: 'facebook' },
      }],
    }, enabledContext)

    expect(mockSocialPostRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app1234567',
      campaignId: 'camp_x',
      state: 'DRAFT',
      platform: 'facebook',
      payload: expect.objectContaining({ message: 'Spring sale!', hashtags: ['spring'], callToAction: 'Shop', platform: 'facebook' }),
    }))
    // UTM minting is the RUBICON-499/500 workstream's job, not 436 — the carrier alone
    // is materialized here so edit/delete has a stable contentRefId to bind to.
    expect(mockMarketingUtmRepo.create).not.toHaveBeenCalled()
    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'social', status: 'draft', contentRefId: 'post-mat1',
      rawContent: expect.stringContaining('"message":"Spring sale!"'),
    }))
  })
})

describe('campaignApplyBlogUtm', () => {
  const DECORATED = '/lp/summer-sale?utm_source=blog-aab&utm_medium=blog&utm_campaign=cmp_X&utm_content=act_Y&utm_term=topic_baking-tips'

  beforeEach(() => {
    mockResolvePublishedUrl.mockResolvedValue('https://example-bakery.com')
    mockDecorateBlogCta.mockReturnValue({ relativePath: DECORATED, absoluteUrl: 'https://example-bakery.com' + DECORATED, utm: {} })
    mockCampaignFindByAppId.mockReturnValue([{ id: 'camp_1', status: 'ready' }])
  })

  function fakeWorkspace(markdownByPath: Record<string, string>): { writes: { path: string; content: string }[] } {
    const writes: { path: string; content: string }[] = []
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({
        view: vi.fn(async ({ path }: { path: string }) => {
          if (markdownByPath[path] === undefined) throw new Error('not found')
          return { path, content: markdownByPath[path] }
        }),
        write: vi.fn(async (opts: { path: string; content: string }) => { writes.push(opts); return {} }),
        readText: vi.fn(async ({ path }: { path: string }) => {
          if (markdownByPath[path] === undefined) throw new Error('not found')
          return markdownByPath[path]
        }),
      }),
    } as never)
    return { writes }
  }

  it('rewrites the bare /lp/<slug> CTA to the decorated link and leaves incidental links bare', async () => {
    const md = 'Tips inside — [grab the deal](/lp/summer-sale) today. (See our [About](/about) page.)'
    const { writes } = fakeWorkspace({ 'src/content/data/blog/baking-tips.md': md })

    const result = await campaignApplyBlogUtm.execute(
      { landingPageSlug: 'summer-sale', blogPosts: [{ slug: 'baking-tips', topicSlug: 'baking tips' }] },
      enabledContext,
    )

    expect(result.success).toBe(true)
    expect(result.decorated).toEqual(['baking-tips'])
    expect(writes).toHaveLength(1)
    expect(writes[0].content).toBe('Tips inside — [grab the deal](' + DECORATED + ') today. (See our [About](/about) page.)')
    expect(mockDecorateBlogCta).toHaveBeenCalledWith(expect.objectContaining({ contentRefId: 'baking-tips', simpleCampaignId: 'camp_1', campaignSlug: 'summer-sale' }))
  })

  it('skips a post that does not link to this campaign (no write)', async () => {
    const { writes } = fakeWorkspace({ 'src/content/data/blog/unrelated.md': 'No campaign CTA here, just [home](/).' })
    const result = await campaignApplyBlogUtm.execute(
      { landingPageSlug: 'summer-sale', blogPosts: [{ slug: 'unrelated' }] },
      enabledContext,
    )
    expect(result.decorated).toEqual([])
    expect(result.skipped).toEqual(['unrelated'])
    expect(writes).toHaveLength(0)
  })

  it('errors when no ready campaign exists yet (campaignPlanCreate must run first)', async () => {
    mockCampaignFindByAppId.mockReturnValue([])
    fakeWorkspace({})
    const result = await campaignApplyBlogUtm.execute(
      { landingPageSlug: 'summer-sale', blogPosts: [{ slug: 'baking-tips' }] },
      enabledContext,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/campaignPlanCreate first/)
  })

  it('is gated by the feature flag', async () => {
    const result = await campaignApplyBlogUtm.execute(
      { landingPageSlug: 'summer-sale', blogPosts: [{ slug: 'baking-tips' }] },
      disabledContext,
    )
    expect(result.success).toBe(false)
  })
})

describe('campaignPlanCreate decorates social CTA with UTM (RUBICON-501 social half)', () => {
  const SOCIAL_UTM_URL: string =
    'https://example-bakery.com/lp/summer-sale?utm_source=facebook&utm_medium=organic_social&utm_campaign=cmp_X&utm_content=act_Y'

  beforeEach(() => {
    mockCampaignFindByAppId.mockReturnValue([])
    mockCampaignCreate.mockReturnValue({ id: 'camp_x' })
    mockCampaignTransition.mockReturnValue({ id: 'camp_x', status: 'ready' })
    mockMediaSearch.searchMedia.mockResolvedValue({ success: false })
    mockSocialPostRepo.create.mockReturnValue({ id: 'post-mat1' })
    mockSocialPostRepo.update.mockReset()
    mockDecorateSocialCta.mockReset()
    mockDecorateSocialCta.mockReturnValue({ absoluteUrl: SOCIAL_UTM_URL, relativePath: '/lp/summer-sale', utm: {} })
    mockResolvePublishedUrl.mockResolvedValue('https://example-bakery.com')
  })

  function socialInput(message: string, platform: string = 'facebook'): Record<string, unknown> {
    return {
      name: 'Summer', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      landingPageSlug: 'summer-sale',
      plannedContent: [{
        assetType: 'social', title: 'Launch post', imageUrl: 'http://img',
        rawContent: { message, hashtags: ['sale'], platform },
      }],
    }
  }

  it('rewrites the /lp CTA in the caption to the absolute tracked URL and persists it to carrier + content row', async () => {
    await run(campaignPlanCreate, socialInput('Big news — shop the sale at /lp/summer-sale today!'), enabledContext)

    expect(mockDecorateSocialCta).toHaveBeenCalledWith(expect.objectContaining({
      contentRefId: 'post-mat1', simpleCampaignId: 'camp_x', campaignSlug: 'summer-sale',
      platform: 'facebook', publishedUrl: 'https://example-bakery.com',
    }))
    expect(mockSocialPostRepo.update).toHaveBeenCalledWith('post-mat1', {
      payload: expect.objectContaining({ message: 'Big news — shop the sale at ' + SOCIAL_UTM_URL + ' today!' }),
    })
    // The decorated caption is also serialized into the content-row projection.
    expect(mockCampaignAddContent).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'social', contentRefId: 'post-mat1', rawContent: expect.stringContaining(SOCIAL_UTM_URL),
    }))
  })

  it('appends the tracked URL for a FB caption with no /lp link (FB/GMB captions carry the link)', async () => {
    await run(campaignPlanCreate, socialInput('Something exciting is coming soon!'), enabledContext)
    expect(mockDecorateSocialCta).toHaveBeenCalled()
    expect(mockSocialPostRepo.update).toHaveBeenCalledWith('post-mat1', {
      payload: expect.objectContaining({ message: 'Something exciting is coming soon!\n\n' + SOCIAL_UTM_URL }),
    })
  })

  it('skips Instagram captions (link-in-bio — no per-post caption link)', async () => {
    await run(campaignPlanCreate, socialInput('Shop at /lp/summer-sale now', 'instagram'), enabledContext)
    expect(mockDecorateSocialCta).not.toHaveBeenCalled()
    expect(mockSocialPostRepo.update).not.toHaveBeenCalled()
  })

  it('skips decoration when the site is not published yet', async () => {
    mockResolvePublishedUrl.mockResolvedValue(null)
    await run(campaignPlanCreate, socialInput('Shop at /lp/summer-sale now'), enabledContext)
    expect(mockDecorateSocialCta).not.toHaveBeenCalled()
    expect(mockSocialPostRepo.update).not.toHaveBeenCalled()
  })

  it('skips decoration when landingPageSlug is not provided', async () => {
    const input: Record<string, unknown> = socialInput('Shop at /lp/summer-sale now')
    delete input.landingPageSlug
    await run(campaignPlanCreate, input, enabledContext)
    expect(mockDecorateSocialCta).not.toHaveBeenCalled()
  })
})

describe('campaignPlanCreate schema — rawContent required for social assets (RUBICON-501)', () => {
  const base = { name: 'Summer', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31', landingPageSlug: 'summer-sale' }

  it('rejects a social asset with no rawContent (the agent cannot silently drop it)', () => {
    const result = campaignPlanCreate.parameters.safeParse({
      ...base,
      plannedContent: [{ assetType: 'social', title: 'Launch post' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a social asset that includes rawContent', () => {
    const result = campaignPlanCreate.parameters.safeParse({
      ...base,
      plannedContent: [{
        assetType: 'social', title: 'Launch post',
        rawContent: { message: 'Shop at /lp/summer-sale', hashtags: ['sale'], platform: 'facebook' },
      }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts a non-social asset without rawContent', () => {
    const result = campaignPlanCreate.parameters.safeParse({
      ...base,
      plannedContent: [{ assetType: 'blog', title: 'SEO post' }],
    })
    expect(result.success).toBe(true)
  })

  it('strips an agent-supplied status (the field was removed; status is system-owned)', () => {
    const result = campaignPlanCreate.parameters.safeParse({
      ...base,
      plannedContent: [{ assetType: 'blog', title: 'SEO post', status: 'scheduled' }],
    })
    expect(result.success).toBe(true)
    expect((result as { data: { plannedContent: Array<Record<string, unknown>> } }).data.plannedContent[0]).not.toHaveProperty('status')
  })
})

describe('setFrontmatterField / frontmatterId (frontmatter stamping)', () => {
  it('replaces an existing field in place and leaves every other line intact', () => {
    const md: string = "---\ntitle: 'Hello'\nid: 'old-id'\ntags: ['a', 'b']\n---\n\nBody text."
    const out: string = setFrontmatterField(md, 'id', 'blog-post-xyz')
    expect(out).toBe("---\ntitle: 'Hello'\nid: 'blog-post-xyz'\ntags: ['a', 'b']\n---\n\nBody text.")
  })

  it('inserts a missing field at the top of an existing frontmatter block', () => {
    const md: string = "---\ntitle: 'Hello'\n---\n\nBody."
    const out: string = setFrontmatterField(md, 'campaignId', 'camp_x')
    expect(out).toBe("---\ncampaignId: 'camp_x'\ntitle: 'Hello'\n---\n\nBody.")
  })

  it('prepends a frontmatter block when the markdown has none', () => {
    const out: string = setFrontmatterField('Just body, no frontmatter.', 'id', 'blog-post-1')
    expect(out).toBe("---\nid: 'blog-post-1'\n---\n\nJust body, no frontmatter.")
  })

  it('round-trips: frontmatterId reads back the value setFrontmatterField stamped', () => {
    const stamped: string = setFrontmatterField("---\ntitle: 'X'\n---\n\nB", 'id', 'blog-post-roundtrip')
    expect(frontmatterId(stamped)).toBe('blog-post-roundtrip')
  })

  it('frontmatterId reads an unquoted id and returns null when absent', () => {
    expect(frontmatterId('---\nid: blog-post-bare\n---\n\nB')).toBe('blog-post-bare')
    expect(frontmatterId("---\ntitle: 'no id here'\n---\n\nB")).toBeNull()
  })
})

describe('campaignPlanCreate stamps blog frontmatter and defers the write past the DB row (RUBICON-443)', () => {
  const BLOG_PATH: string = 'src/content/data/blog/seo-post.md'
  const BLOG_MD: string = "---\ntitle: 'SEO Post'\npublishedAt: '2026-07-02T00:00:00Z'\npublished: true\n---\n\nRead more and [grab the deal](/lp/summer)."

  beforeEach(() => {
    mockCampaignFindByAppId.mockReturnValue([])
    mockCampaignCreate.mockReturnValue({ id: 'camp_x' })
    mockCampaignTransition.mockReturnValue({ id: 'camp_x', status: 'ready' })
    mockMediaSearch.searchMedia.mockResolvedValue({ success: false })
    mockResolvePublishedUrl.mockResolvedValue(null)
    mockCampaignAddContent.mockReset().mockReturnValue({})
  })

  function fakeBlogWorkspace(markdownByPath: Record<string, string>): { writes: { path: string; content: string }[] } {
    const writes: { path: string; content: string }[] = []
    vi.mocked(createForWorkspace).mockReturnValue({
      files: createStubWorkspaceFiles({
        readText: vi.fn(async ({ path }: { path: string }): Promise<string> => {
          if (markdownByPath[path] === undefined) throw new Error('not found')
          return markdownByPath[path]
        }),
        write: vi.fn(async (opts: { path: string; content: string }): Promise<unknown> => { writes.push(opts); return {} }),
      }),
    } as never)
    return { writes }
  }

  it('stamps id + campaignId into the file and sets contentRefId to that same id', async () => {
    const { writes } = fakeBlogWorkspace({ [BLOG_PATH]: BLOG_MD })

    await run(campaignPlanCreate, {
      name: 'Summer', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{ assetType: 'blog', title: 'SEO Post', slug: 'seo-post' }],
    }, enabledContext)

    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe(BLOG_PATH)
    const stamped: string = writes[0].content
    expect(stamped).toContain("campaignId: 'camp_x'")
    expect(frontmatterId(stamped)).toMatch(/^blog-post-/)

    const addContentArg: Record<string, unknown> = mockCampaignAddContent.mock.calls[0][0]
    expect(addContentArg.assetType).toBe('blog')
    expect(addContentArg.status).toBe('draft')
    expect(addContentArg.contentRefId).toBe(frontmatterId(stamped))
    expect(addContentArg.rawContent).toBe(stamped)
  })

  it('does not write the stamped file when the DB row write throws (no orphaned file id)', async () => {
    const { writes } = fakeBlogWorkspace({ [BLOG_PATH]: BLOG_MD })
    mockCampaignAddContent.mockImplementation((): never => { throw new Error('db unavailable') })

    await expect(run(campaignPlanCreate, {
      name: 'Summer', offer: 'Save', startDate: '2026-07-01', endDate: '2026-07-31',
      plannedContent: [{ assetType: 'blog', title: 'SEO Post', slug: 'seo-post' }],
    }, enabledContext)).rejects.toThrow('db unavailable')

    // The write is deferred until after addContent succeeds, so a failed DB row leaves no stamped file.
    expect(writes).toHaveLength(0)
  })
})
