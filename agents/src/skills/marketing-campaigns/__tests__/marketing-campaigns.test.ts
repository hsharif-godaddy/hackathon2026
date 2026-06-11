import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { tools, campaignPlanPropose, campaignPlanCreate, campaignCreate } from '../tools/index.js'

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
  assets: [{ assetType: 'social' as const, title: 'Teaser post' }],
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

  it('exports exactly the three orchestrator tools', () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      'campaignPlanPropose',
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
    expect(plan).toMatch(/one-line rationale/i)
  })

  it('PLAN proposes name + dates (date-aware) and frames around outcomes', () => {
    const plan = readSection('templates/sections/02-plan.md')
    expect(plan).toMatch(/propose everything else/i)
    expect(plan).toMatch(/be date-aware/i)
    expect(plan).toMatch(/The goal, in business terms/i)
    expect(plan).toMatch(/what the key assets do/i) // one-line "why" that educates the owner
  })

  it('PLAN surfaces assumptions and invites correction before the plan card', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/What I understood about your business/i)
    expect(plan).toMatch(/tell me if any of this is off/i)
    expect(skill).toMatch(/Never skip the assumptions intro/i)
  })

  it('PLAN sets expectations qualitatively and forbids fabricated numbers', () => {
    const plan = readSection('templates/sections/02-plan.md')
    const skill = readSection('skill.md')
    expect(plan).toMatch(/qualitatively only/i)
    expect(plan).toMatch(/NEVER invent numbers/i)
    expect(skill).toMatch(/Never invent specific performance numbers/i)
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

  it('all five phase sections exist', () => {
    for (const section of ['01-clarify', '02-plan', '03-verify', '04-generate', '05-summary']) {
      expect(() => readSection(`templates/sections/${section}.md`)).not.toThrow()
    }
  })
})
