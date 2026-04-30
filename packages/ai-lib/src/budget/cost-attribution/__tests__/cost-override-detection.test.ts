/**
 * Cost Override Action Detection Tests
 *
 * Tests for detecting cost override tools by name for cost attribution.
 */

import { describe, it, expect } from 'vitest'
import {
  getCostOverrideAction,
  getCostOverrideSignal,
  analyzeCostOverrideActions
} from '../cost-override-detection.js'
import { CostOverrideAction, type ExecutionStep, type StepContentItem } from '../types.js'

// HELPERS

function createStep(content: StepContentItem[], correlationId?: string): ExecutionStep {
  return {
    content,
    response: correlationId ? { headers: { 'x-correlation-id': correlationId } } : undefined,
  }
}

function toolResult(toolName: string, output?: unknown): StepContentItem {
  return { type: 'tool-result', toolName, output }
}

function toolCall(toolName: string, input?: unknown): StepContentItem {
  return { type: 'tool-call', toolName, input }
}

// getCostOverrideAction

describe('getCostOverrideAction', () => {
  it('returns null for undefined toolName', () => {
    expect(getCostOverrideAction(undefined)).toBeNull()
  })

  it('returns null for non-cost override tool', () => {
    expect(getCostOverrideAction('read')).toBeNull()
    expect(getCostOverrideAction('edit')).toBeNull()
    expect(getCostOverrideAction('bash')).toBeNull()
  })

  it('matches publish tool (case-insensitive)', () => {
    expect(getCostOverrideAction('publish')).toBe(CostOverrideAction.Publish)
    expect(getCostOverrideAction('Publish')).toBe(CostOverrideAction.Publish)
    expect(getCostOverrideAction('PUBLISH')).toBe(CostOverrideAction.Publish)
  })

  it('matches domainPurchase tool (case-insensitive)', () => {
    expect(getCostOverrideAction('domainPurchase')).toBe(CostOverrideAction.Domain)
    expect(getCostOverrideAction('domainpurchase')).toBe(CostOverrideAction.Domain)
    expect(getCostOverrideAction('DOMAINPURCHASE')).toBe(CostOverrideAction.Domain)
  })

  it('matches skill-namespaced publish tool', () => {
    expect(getCostOverrideAction('publishing__publish')).toBe(CostOverrideAction.Publish)
    expect(getCostOverrideAction('Publishing__Publish')).toBe(CostOverrideAction.Publish)
  })

  it('matches skill-namespaced domain tool', () => {
    expect(getCostOverrideAction('custom_domain__domainPurchase')).toBe(CostOverrideAction.Domain)
    expect(getCostOverrideAction('custom_domain__domainpurchase')).toBe(CostOverrideAction.Domain)
  })

  it('does not match partial tool names', () => {
    expect(getCostOverrideAction('publishSomething')).toBeNull()
    expect(getCostOverrideAction('domainPurchaseExtra')).toBeNull()
  })
})

// getCostOverrideSignal

describe('getCostOverrideSignal', () => {
  it('returns null for step without tool calls or results', () => {
    const step = createStep([{ type: 'text', text: 'Hello' }], 'call-1')
    expect(getCostOverrideSignal(step)).toBeNull()
  })

  it('returns null when tool is not cost override', () => {
    const step = createStep([toolResult('read', { content: 'file content' })], 'call-1')
    expect(getCostOverrideSignal(step)).toBeNull()
  })

  it('finds cost override signal for publish tool-call (decision)', () => {
    const step = createStep([toolCall('publishing__publish')], 'call-1')
    const signal = getCostOverrideSignal(step)
    expect(signal).toEqual({ action: CostOverrideAction.Publish, toolName: 'publishing__publish' })
  })

  it('finds cost override signal for publish tool-result (execution)', () => {
    const step = createStep([toolResult('publishing__publish', { success: true })], 'call-1')
    const signal = getCostOverrideSignal(step)
    expect(signal).toEqual({ action: CostOverrideAction.Publish, toolName: 'publishing__publish' })
  })

  it('finds cost override signal for domain tool', () => {
    const step = createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-1')
    const signal = getCostOverrideSignal(step)
    expect(signal).toEqual({ action: CostOverrideAction.Domain, toolName: 'custom_domain__domainPurchase' })
  })

  it('finds first cost override signal when multiple tool results exist', () => {
    const step = createStep([
      toolResult('read', { content: 'file content' }),
      toolResult('publishing__publish', { success: true }),
    ], 'call-1')
    const signal = getCostOverrideSignal(step)
    expect(signal).toEqual({ action: CostOverrideAction.Publish, toolName: 'publishing__publish' })
  })
})

// analyzeCostOverrideActions

describe('analyzeCostOverrideActions', () => {
  it('returns empty sets for empty steps', () => {
    const result = analyzeCostOverrideActions([])
    expect(result.actionCallIds.size).toBe(0)
    expect(result.followUpCallIds.size).toBe(0)
    expect(result.actions.size).toBe(0)
  })

  it('returns empty sets when no cost override actions', () => {
    const steps = [
      createStep([toolResult('read', { content: 'abc' })], 'call-1'),
      createStep([toolResult('edit', { success: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)
    expect(result.actionCallIds.size).toBe(0)
    expect(result.followUpCallIds.size).toBe(0)
  })

  it('captures correlation ID of cost override tool', () => {
    const steps = [
      createStep([toolResult('read', { content: 'abc' })], 'call-1'),
      createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)
    expect(result.actionCallIds.has('call-2')).toBe(true)
    expect(result.actionCallIds.size).toBe(1)
    expect(result.actions.get('call-2')).toBe(CostOverrideAction.Publish)
  })

  it('captures text-only follow-ups and status checks after publish', () => {
    // "publish my app" - publish, status check, and completion all go to GoDaddy
    // But work tools (edit) exit the flow
    const steps = [
      createStep([toolResult('publishing__publish', { success: true })], 'call-1'),
      createStep([toolResult('publishing__status', { health: 'ok' })], 'call-2'), // status check
      createStep([{ type: 'text', text: 'Your app has been published!' }], 'call-3'), // completion
      createStep([toolResult('edit', { success: true })], 'call-4'), // exits flow
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 is the cost override action - captured
    expect(result.actionCallIds.has('call-1')).toBe(true)

    // call-2 is status check (allowed in flow) - captured
    expect(result.followUpCallIds.has('call-2')).toBe(true)

    // call-3 is text-only follow-up (completion message) - captured
    expect(result.followUpCallIds.has('call-3')).toBe(true)

    // call-4 is not in allowlist - exits the flow
    expect(result.followUpCallIds.has('call-4')).toBe(false)
  })

  it('exits cost override flow when tool call encountered (mixed sessions)', () => {
    // "publish my app and build an about page" - about page work is customer cost
    const steps = [
      createStep([toolResult('publishing__publish', { success: true })], 'call-1'),
      createStep([toolResult('edit', { success: true })], 'call-2'), // about page work
      createStep([{ type: 'text', text: 'Done!' }], 'call-3'), // NOT captured (after exit)
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 is the cost override action
    expect(result.actionCallIds.has('call-1')).toBe(true)

    // call-2 has tool calls - exits the flow, not captured
    expect(result.followUpCallIds.has('call-2')).toBe(false)

    // call-3 is after flow exit - not captured
    expect(result.followUpCallIds.has('call-3')).toBe(false)
  })

  it('exits flow when unrelated skill status tool is used (e.g., database__status)', () => {
    // Bare 'status' or other skill's status tool should NOT stay in publish flow
    // This prevents false positives like 'database__status' being attributed to GoDaddy
    const steps = [
      createStep([toolResult('publishing__publish', { success: true })], 'call-1'),
      createStep([toolResult('database__status', { connected: true })], 'call-2'), // unrelated status
      createStep([{ type: 'text', text: 'Database is connected!' }], 'call-3'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 is the action
    expect(result.actionCallIds.has('call-1')).toBe(true)

    // call-2 uses database__status which is NOT in the publish flow allowlist - exits flow
    expect(result.followUpCallIds.has('call-2')).toBe(false)

    // call-3 is after flow exit - not captured
    expect(result.followUpCallIds.has('call-3')).toBe(false)
  })

  it('handles multiple cost override actions with re-entry', () => {
    const steps = [
      createStep([toolResult('publishing__publish', { success: true })], 'call-1'),
      createStep([toolResult('edit', { success: true })], 'call-2'), // exits flow
      createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-3'), // re-enters flow
      createStep([{ type: 'text', text: 'Domain configured!' }], 'call-4'), // follow-up
    ]
    const result = analyzeCostOverrideActions(steps)

    // Both cost override actions captured
    expect(result.actionCallIds.has('call-1')).toBe(true)
    expect(result.actionCallIds.has('call-3')).toBe(true)
    expect(result.actionCallIds.size).toBe(2)

    // Actions tracked
    expect(result.actions.get('call-1')).toBe(CostOverrideAction.Publish)
    expect(result.actions.get('call-3')).toBe(CostOverrideAction.Domain)

    // call-2 exits flow (has tool calls)
    expect(result.followUpCallIds.has('call-2')).toBe(false)

    // call-4 is text-only follow-up after domain action
    expect(result.followUpCallIds.has('call-4')).toBe(true)
  })

  it('skips steps without correlation IDs', () => {
    const steps = [
      createStep([toolResult('publishing__publish', { success: true })]), // No correlation ID
      createStep([toolResult('publishing__status', { running: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // First step has no correlation ID, so not captured in actionCallIds
    expect(result.actionCallIds.size).toBe(0)
    // call-2 is not a cost override action (status is flow tool, not action) and not tracked as follow-up
    // because no action was captured yet (the publish step had no correlation ID)
    expect(result.followUpCallIds.has('call-2')).toBe(false)
  })

  it('response tool steps before first cost override action ARE included as prep work', () => {
    // Text response before publish is part of the publish flow
    const steps = [
      createStep([toolResult('suggestedResponse', { text: 'Publishing now...' })], 'call-1'), // response tool
      createStep([{ type: 'text', text: 'Starting publish' }], 'call-2'), // text-only
      createStep([toolResult('publishing__publish', { success: true })], 'call-3'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 and call-2 are prep work before the action - captured as follow-ups
    expect(result.followUpCallIds.has('call-1')).toBe(true)
    expect(result.followUpCallIds.has('call-2')).toBe(true)

    // call-3 is the action itself
    expect(result.actionCallIds.has('call-3')).toBe(true)
  })

  it('skill loading unrelated skill before cost override action is NOT promoted', () => {
    // Skill tool loading unrelated skill (commerce) should not be promoted for publish action
    const steps = [
      createStep([toolResult('skill', { skill: 'commerce' })], 'call-1'), // unrelated skill
      createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 loaded 'commerce' which doesn't match 'publish' action - NOT captured
    expect(result.followUpCallIds.has('call-1')).toBe(false)

    // call-2 is the action itself - captured
    expect(result.actionCallIds.has('call-2')).toBe(true)
  })

  it('skill loading publishing skill before publish action IS retroactively promoted', () => {
    // Skill tool loading 'publishing' should be promoted when publish action is detected
    const steps = [
      createStep([toolResult('skill', { skill: 'publishing' })], 'call-1'), // loads publishing
      createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 loaded 'publishing' which matches 'publish' action - retroactively promoted
    expect(result.followUpCallIds.has('call-1')).toBe(true)

    // call-2 is the action itself - captured
    expect(result.actionCallIds.has('call-2')).toBe(true)
  })

  it('skill loading custom-domain skill before domain action IS retroactively promoted', () => {
    // Skill tool loading 'custom-domain' should be promoted when domain action is detected
    const steps = [
      createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-1'), // loads custom-domain
      createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 loaded 'custom-domain' which matches 'domain' action - retroactively promoted
    expect(result.followUpCallIds.has('call-1')).toBe(true)

    // call-2 is the action itself - captured
    expect(result.actionCallIds.has('call-2')).toBe(true)
    expect(result.actions.get('call-2')).toBe(CostOverrideAction.Domain)
  })

  it('retroactive promotion only applies to matching skill, not unrelated skills', () => {
    // Mixed skills before action - only the matching one is promoted
    const steps = [
      createStep([toolResult('skill', { skill: 'commerce' })], 'call-1'), // unrelated
      createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-2'), // matches domain
      createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-3'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 loaded 'commerce' - NOT promoted
    expect(result.followUpCallIds.has('call-1')).toBe(false)

    // call-2 loaded 'custom-domain' - promoted
    expect(result.followUpCallIds.has('call-2')).toBe(true)

    // call-3 is the action itself
    expect(result.actionCallIds.has('call-3')).toBe(true)
  })

  it('work tool steps before cost override action are NOT included (no retroactive capture)', () => {
    // User did some edits first, then asked to publish - edits are customer work
    const steps = [
      createStep([toolResult('read', { content: 'abc' })], 'call-1'), // work tool
      createStep([toolResult('edit', { success: true })], 'call-2'), // work tool
      createStep([toolResult('publishing__publish', { success: true })], 'call-3'),
    ]
    const result = analyzeCostOverrideActions(steps)

    // call-1 and call-2 are work tools - NOT captured even though an action follows
    // (they represent user's own work, not prep for the publish action)
    expect(result.followUpCallIds.has('call-1')).toBe(false)
    expect(result.followUpCallIds.has('call-2')).toBe(false)

    // Only call-3 is captured
    expect(result.actionCallIds.has('call-3')).toBe(true)
  })

  // RETROACTIVE SKILL PROMOTION - EXTENDED TESTS

  describe('retroactive skill promotion', () => {
    it('extracts skill name from "loaded" field variant', () => {
      // Some skill tool implementations use { loaded: "skillName" }
      const steps = [
        createStep([toolResult('skill', { loaded: 'custom-domain' })], 'call-1'),
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('extracts skill name from "name" field variant', () => {
      // Some skill tool implementations use { name: "skillName" }
      const steps = [
        createStep([toolResult('skill', { name: 'publishing' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('handles case-insensitive skill name matching', () => {
      // Skill names should match regardless of case
      const steps = [
        createStep([toolResult('skill', { skill: 'Custom-Domain' })], 'call-1'),
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
    })

    it('handles uppercase skill names', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'PUBLISHING' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
    })

    it('does NOT promote skill load when output is null', () => {
      const steps = [
        createStep([toolResult('skill', null)], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('does NOT promote skill load when output is undefined', () => {
      const steps = [
        createStep([toolResult('skill', undefined)], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('does NOT promote skill load when skill field is not a string', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 123 })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('does NOT promote skill load when output has no recognizable skill field', () => {
      const steps = [
        createStep([toolResult('skill', { success: true, message: 'Loaded!' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('does NOT promote non-skill tools that happen to have skill-like output', () => {
      // Only the 'skill' tool should be eligible for retroactive promotion
      const steps = [
        createStep([toolResult('read', { skill: 'publishing' })], 'call-1'), // not 'skill' tool
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('promotes multiple skill loads for the same action', () => {
      // Edge case: skill loaded twice (maybe user reloaded)
      const steps = [
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-1'),
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-2'),
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-3'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
      expect(result.followUpCallIds.has('call-2')).toBe(true)
      expect(result.actionCallIds.has('call-3')).toBe(true)
    })

    it('does NOT retroactively promote after first action (only promotes before)', () => {
      // Skill loading after an action should not affect anything
      const steps = [
        createStep([toolResult('publishing__publish', { success: true })], 'call-1'),
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-2'), // after first action
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-3'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.actionCallIds.has('call-1')).toBe(true)
      // call-2 is after first action, flow exited due to 'skill' not being in COST_OVERRIDE_FLOW_TOOLS
      expect(result.followUpCallIds.has('call-2')).toBe(false)
      // call-3 re-enters the flow as a new action
      expect(result.actionCallIds.has('call-3')).toBe(true)
    })

    it('handles step with multiple tool results including skill', () => {
      // Step has both skill result and another tool result
      const steps = [
        createStep([
          toolResult('skill', { skill: 'custom-domain' }),
          toolResult('read', { content: 'file content' }),
        ], 'call-1'),
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // Step contains non-flow tool (read), so entire step is skipped from prep
      // But we still check skipped steps for skill loading
      expect(result.followUpCallIds.has('call-1')).toBe(true) // retroactively promoted due to skill load
    })

    it('skill load step without correlation ID is NOT promoted', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'custom-domain' })]), // no correlation ID
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // Can't promote without correlation ID
      expect(result.followUpCallIds.size).toBe(0)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('handles real-world domain flow: skill load + domainPurchase + text response', () => {
      // This matches the actual "connect a domain" flow from logs
      const steps = [
        createStep([
          toolResult('skill', { skill: 'custom-domain' }),
          toolResult('skill', { skill: 'custom-domain' }), // sometimes called twice
        ], 'call-1'),
        createStep([toolResult('custom_domain__domainPurchase', {
          success: true,
          widgetType: 'domain-purchase',
          message: 'Domain purchase widget rendered for RecipeNest'
        })], 'call-2'),
        createStep([{ type: 'text', text: "I'll help you add a custom domain to RecipeNest!" }], 'call-3'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // All three calls should be attributed to GoDaddy
      expect(result.followUpCallIds.has('call-1')).toBe(true) // skill load - retroactively promoted
      expect(result.actionCallIds.has('call-2')).toBe(true) // domain action
      expect(result.followUpCallIds.has('call-3')).toBe(true) // text follow-up
    })

    it('handles real-world publish flow: skill load + publish + status + text', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'publishing' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
        createStep([toolResult('publishing__status', { health: 'ok' })], 'call-3'),
        createStep([{ type: 'text', text: 'Your app has been published!' }], 'call-4'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true) // skill load - retroactively promoted
      expect(result.actionCallIds.has('call-2')).toBe(true) // publish action
      expect(result.followUpCallIds.has('call-3')).toBe(true) // status check
      expect(result.followUpCallIds.has('call-4')).toBe(true) // text follow-up
    })

    it('mixed workflow: edit, skill load, domain action - only skill load + action attributed', () => {
      // User says "edit the header and connect a domain"
      const steps = [
        createStep([toolResult('edit', { success: true })], 'call-1'), // customer work
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-2'), // skill load
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-3'),
        createStep([{ type: 'text', text: 'Done!' }], 'call-4'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false) // customer work - NOT promoted
      expect(result.followUpCallIds.has('call-2')).toBe(true) // skill load - promoted
      expect(result.actionCallIds.has('call-3')).toBe(true) // domain action
      expect(result.followUpCallIds.has('call-4')).toBe(true) // text follow-up
    })

    it('does NOT promote skill load for mismatched action (publishing skill, domain action)', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'publishing' })], 'call-1'), // publishing skill
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-2'), // domain action
      ]
      const result = analyzeCostOverrideActions(steps)

      // publishing skill doesn't match domain action
      expect(result.followUpCallIds.has('call-1')).toBe(false)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('does NOT promote skill load for mismatched action (custom-domain skill, publish action)', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-1'), // domain skill
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'), // publish action
      ]
      const result = analyzeCostOverrideActions(steps)

      // custom-domain skill doesn't match publish action
      expect(result.followUpCallIds.has('call-1')).toBe(false)
      expect(result.actionCallIds.has('call-2')).toBe(true)
    })

    it('handles empty string skill name', () => {
      const steps = [
        createStep([toolResult('skill', { skill: '' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('handles whitespace-only skill name', () => {
      const steps = [
        createStep([toolResult('skill', { skill: '   ' })], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // Whitespace doesn't match any skill
      expect(result.followUpCallIds.has('call-1')).toBe(false)
    })

    it('uses result field as fallback when output is undefined', () => {
      // StepContentItem supports both 'output' and 'result' fields
      const steps = [
        createStep([{ type: 'tool-result', toolName: 'skill', result: { skill: 'publishing' } } as StepContentItem], 'call-1'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-2'),
      ]
      const result = analyzeCostOverrideActions(steps)

      expect(result.followUpCallIds.has('call-1')).toBe(true)
    })

    it('multiple unrelated skill loads before action - none promoted', () => {
      const steps = [
        createStep([toolResult('skill', { skill: 'commerce' })], 'call-1'),
        createStep([toolResult('skill', { skill: 'database' })], 'call-2'),
        createStep([toolResult('skill', { skill: 'email' })], 'call-3'),
        createStep([toolResult('publishing__publish', { success: true })], 'call-4'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // None of these match 'publish' action
      expect(result.followUpCallIds.has('call-1')).toBe(false)
      expect(result.followUpCallIds.has('call-2')).toBe(false)
      expect(result.followUpCallIds.has('call-3')).toBe(false)
      expect(result.actionCallIds.has('call-4')).toBe(true)
    })

    it('skill load mixed with allowed prep (suggestedResponse) before action', () => {
      const steps = [
        createStep([toolResult('suggestedResponse', { text: 'Starting...' })], 'call-1'), // allowed prep
        createStep([toolResult('skill', { skill: 'custom-domain' })], 'call-2'), // skill load (skipped initially)
        createStep([{ type: 'text', text: 'Loading...' }], 'call-3'), // text-only (allowed prep)
        createStep([toolResult('custom_domain__domainPurchase', { success: true })], 'call-4'),
      ]
      const result = analyzeCostOverrideActions(steps)

      // call-1 and call-3 are allowed prep (promoted via prepCallIds)
      expect(result.followUpCallIds.has('call-1')).toBe(true)
      expect(result.followUpCallIds.has('call-3')).toBe(true)
      // call-2 is skill load (promoted via retroactive promotion)
      expect(result.followUpCallIds.has('call-2')).toBe(true)
      expect(result.actionCallIds.has('call-4')).toBe(true)
    })
  })
})
