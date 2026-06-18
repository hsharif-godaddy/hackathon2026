import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../../../workspace/index.js', () => ({ createForWorkspace: vi.fn() }))

import { tools, campaignPlanPropose, campaignPlanCreate, campaignCreate, campaignScaffoldPage, sanitizeSlug, buildLandingPage } from '../tools/index.js'
import { createForWorkspace } from '../../../workspace/index.js'

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
  it('CLARIFY asks only promoting + goal — name, dates, channels are proposed not asked', () => {
    const clarify = readSection('templates/sections/01-clarify.md')
    // Assert against the askQuestion code block so the prose (which legitimately
    // mentions "name"/"channels" in prohibitions) does not give a false pass.
    const example = clarify.match(/```javascript[\s\S]*?```/)?.[0] ?? ''
    expect(example).toMatch(/promoting/i)
    expect(example).not.toMatch(/channel/i)
    expect(example).not.toMatch(/\bname\b/i) // the campaign name is proposed, never asked
    expect(clarify).toMatch(/SINGLE askQuestion call/i)
    expect(clarify).toMatch(/Do NOT ask a second round/i)
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

  it('all five phase sections exist', () => {
    for (const section of ['01-clarify', '02-plan', '03-verify', '04-generate', '05-summary']) {
      expect(() => readSection(`templates/sections/${section}.md`)).not.toThrow()
    }
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
