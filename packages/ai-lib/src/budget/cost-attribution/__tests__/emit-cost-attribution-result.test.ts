import { describe, it, expect, vi, beforeEach } from 'vitest'

import { buildAttributionPayload, emitCostAttributionResult } from '../emit-cost-attribution-result.js'
import type { AttributionPayload } from '../emit-cost-attribution-result.js'
import type { AttributionResult, ExecutionData, ItemAttribution } from '../types.js'
import { emptyExecutionData, ReportLabel } from '../types.js'

vi.mock('@godaddy/agent-otel-sdk', () => ({
  emitCustomEvent: vi.fn(),
}))

import { emitCustomEvent } from '@godaddy/agent-otel-sdk'

const IDS = {
  budgetId: 'budget-abc',
  budgetSessionId: 'session-xyz',
  reportId: 'report-123',
}

function createExecutionData(overrides: Partial<ExecutionData> = {}): ExecutionData {
  return {
    failedCallIds: new Set<string>(),
    patterns: [],
    causalChains: [],
    failedTargets: [],
    hadFailures: false,
    totalSteps: 5,
    costOverride: {
      actionCallIds: new Set<string>(),
      followUpCallIds: new Set<string>(),
      actions: new Map(),
    },
    infrastructureCalls: new Map(),
    ...overrides,
  }
}

/** Per-call attribution payload (mirrors the rule-based path that produces an AttributionResult). */
function perCallAttribution(overrides: Partial<AttributionPayload> = {}): AttributionPayload {
  return {
    customerCost: 0.5,
    godaddyCost: 0.5,
    costsByLabel: { [ReportLabel.ToolFailure]: 0.5 },
    labels: [ReportLabel.ToolFailure],
    perCall: [{
      callRequestId: 'call-1',
      cost: 0.5,
      payer: 'godaddy',
      reason: 'tool_error',
      label: ReportLabel.ToolFailure,
    }],
    ...overrides,
  }
}

/** Single-bucket fallback payload (mirrors non-per-call paths: full_override / no_value / user_aborted / default). */
function fallbackAttribution(overrides: Partial<AttributionPayload> = {}): AttributionPayload {
  return {
    customerCost: 0,
    godaddyCost: 0,
    labels: [ReportLabel.General],
    perCall: [],
    ...overrides,
  }
}

describe('emitCostAttributionResult', function suite() {
  beforeEach(function reset() {
    vi.clearAllMocks()
  })

  it('should emit under the cost-attribution-result/v1 schemaId', function schemaId() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData(),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'default',
      attribution: fallbackAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    expect(eventData.schemaId).toBe('urn:shared:ai:event:/airo-app-builder/cost-attribution-result/v1')
  })

  it('should emit with per-call attribution result', function perCall() {
    const executionData = createExecutionData({
      failedCallIds: new Set(['call-1']),
      hadFailures: true,
      totalSteps: 10,
    })

    emitCostAttributionResult({
      ...IDS,
      executionData,
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'per_call',
      attribution: perCallAttribution(),
    })

    expect(emitCustomEvent).toHaveBeenCalledOnce()
    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input, output } = eventData.data as { input: Record<string, unknown>; output: Record<string, unknown> }

    expect(input.executionData).toEqual({
      failedCallIds: ['call-1'],
      patterns: [],
      causalChains: [],
      failedTargets: [],
      hadFailures: true,
      totalSteps: 10,
      costOverride: {
        actionCallIds: [],
        followUpCallIds: [],
        actions: {},
      },
      infrastructureCallIds: [],
    })

    expect(output.method).toBe('rule_based')
    expect(output.attributionPath).toBe('per_call')
    expect(output.totalCost).toBe(1.0)
    expect(output.sessionWasFree).toBe(false)

    const attribution = output.attribution as Record<string, unknown>
    expect(attribution.customerCost).toBe(0.5)
    expect(attribution.godaddyCost).toBe(0.5)
    expect(attribution.labels).toEqual([ReportLabel.ToolFailure])
    expect(attribution.perCall).toHaveLength(1)
    expect(attribution.costsByLabel).toEqual({ [ReportLabel.ToolFailure]: 0.5 })
  })

  it.each(['attribution_failed', 'default'] as const)(
    'should pass fallback attribution payload through verbatim for %s path',
    function fallbackVerbatim(attributionPath) {
      emitCostAttributionResult({
        ...IDS,
        executionData: emptyExecutionData(),
        totalCost: 1.5,
        sessionWasFree: false,
        attributionPath,
        attribution: fallbackAttribution({ customerCost: 1.5 }),
      })

      const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
      const { output } = eventData.data as { output: Record<string, unknown> }
      const attribution = output.attribution as Record<string, unknown>

      expect(output.attributionPath).toBe(attributionPath)
      expect(attribution.customerCost).toBe(1.5)
      expect(attribution.godaddyCost).toBe(0)
      expect(attribution.labels).toEqual([ReportLabel.General])
      expect(attribution.perCall).toEqual([])
    },
  )

  it('should signal user-aborted via attributionPath only (no wasUserAborted field)', function userAborted() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({ noValueDelivered: true }),
      totalCost: 0.3,
      sessionWasFree: false,
      attributionPath: 'user_aborted',
      attribution: fallbackAttribution({ customerCost: 0.3 }),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { output } = eventData.data as { output: Record<string, unknown> }

    expect(output.attributionPath).toBe('user_aborted')
    expect(output).not.toHaveProperty('wasUserAborted')
  })

  it('should serialize failedCallIds Set to an array', function failedCallIdsToArray() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({
        failedCallIds: new Set(['a', 'b', 'c']),
      }),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'default',
      attribution: fallbackAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as { input: { executionData: Record<string, unknown> } }

    expect(Array.isArray(input.executionData.failedCallIds)).toBe(true)
    expect(input.executionData.failedCallIds).toEqual(['a', 'b', 'c'])
  })

  it('should serialize costOverride Sets/Map and infrastructure call IDs', function costOverrideAndInfra() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({
        costOverride: {
          actionCallIds: new Set(['call-publ1']),
          followUpCallIds: new Set(['call-publ2', 'call-publ3']),
          actions: new Map([
            ['call-publ1', 'publish'],
            ['call-publ2', 'publish'],
          ]),
        },
        infrastructureCalls: new Map([
          ['call-infra1', 'todo_list'],
          ['call-infra2', 'suggested_response'],
        ]),
      }),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'per_call',
      attribution: perCallAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: {
        executionData: {
          costOverride: Record<string, unknown>
          infrastructureCallIds: unknown
        }
      }
    }

    expect(input.executionData.costOverride).toEqual({
      actionCallIds: ['call-publ1'],
      followUpCallIds: ['call-publ2', 'call-publ3'],
      actions: {
        'call-publ1': 'publish',
        'call-publ2': 'publish',
      },
    })
    expect(input.executionData.infrastructureCallIds).toEqual(['call-infra1', 'call-infra2'])
  })

  // A malformed ExecutionData should produce a partial event, not be dropped.
  it('emits a partial event when ExecutionData fields are missing', function tolerateMissingFields() {
    const malformed = {
      patterns: [],
      causalChains: [],
      failedTargets: [],
      hadFailures: false,
      totalSteps: 0,
    } as unknown as ExecutionData

    expect(() =>
      emitCostAttributionResult({
        ...IDS,
        executionData: malformed,
        totalCost: 1.0,
        sessionWasFree: false,
        attributionPath: 'attribution_failed',
        attribution: fallbackAttribution(),
      }),
    ).not.toThrow()

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: {
        executionData: {
          failedCallIds: string[]
          infrastructureCallIds: string[]
          costOverride: { actionCallIds: string[]; followUpCallIds: string[]; actions: Record<string, string> }
        }
      }
    }

    expect(input.executionData.failedCallIds).toEqual([])
    expect(input.executionData.infrastructureCallIds).toEqual([])
    expect(input.executionData.costOverride).toEqual({
      actionCallIds: [],
      followUpCallIds: [],
      actions: {},
    })
  })

  // Pins the `?? ''` guards in serializeExecutionData. The casts force undefined
  // past the type system to simulate a future deserializer that produces
  // structurally-typed-but-runtime-undefined string fields; without the guards
  // truncate() throws and the whole OTel event silently drops.
  it('emits a partial event when pattern.details / causalChain.errorMessage are undefined', function tolerateMissingPatternStrings() {
    const malformed = {
      failedCallIds: new Set<string>(),
      patterns: [{ type: 'edit_read_loop', severity: 0.5, callIds: ['call-1'], details: undefined as unknown as string }],
      causalChains: [{
        triggerCallId: 'call-1',
        triggerTarget: 'foo.ts',
        errorCallId: 'call-2',
        errorMessage: undefined as unknown as string,
        fixCallIds: ['call-3'],
      }],
      failedTargets: [],
      hadFailures: false,
      totalSteps: 0,
      costOverride: { actionCallIds: new Set<string>(), followUpCallIds: new Set<string>(), actions: new Map() },
      infrastructureCalls: new Map(),
    } satisfies ExecutionData

    expect(() =>
      emitCostAttributionResult({
        ...IDS,
        executionData: malformed,
        totalCost: 1.0,
        sessionWasFree: false,
        attributionPath: 'attribution_failed',
        attribution: fallbackAttribution(),
      }),
    ).not.toThrow()

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: { executionData: { patterns: Array<{ details: string }>; causalChains: Array<{ errorMessage: string }> } }
    }
    expect(input.executionData.patterns[0].details).toBe('')
    expect(input.executionData.causalChains[0].errorMessage).toBe('')
  })

  // Pins the per-sub-field guards on costOverride. The "missing fields" test above
  // omits costOverride entirely, which only proves the optional-chain (`costOverride?.`)
  // works. This pins each individual `?? []` / `?? new Map()`.
  it('emits a partial event when costOverride sub-fields are missing', function toleratePartialCostOverride() {
    const malformed = {
      failedCallIds: new Set<string>(['call-1']),
      patterns: [],
      causalChains: [],
      failedTargets: [],
      hadFailures: false,
      totalSteps: 1,
      costOverride: {
        actionCallIds: new Set<string>(['call-publ1']),
      },
      infrastructureCalls: new Map(),
    } as unknown as ExecutionData

    expect(() =>
      emitCostAttributionResult({
        ...IDS,
        executionData: malformed,
        totalCost: 1.0,
        sessionWasFree: false,
        attributionPath: 'per_call',
        attribution: perCallAttribution(),
      }),
    ).not.toThrow()

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: {
        executionData: {
          costOverride: { actionCallIds: string[]; followUpCallIds: string[]; actions: Record<string, string> }
        }
      }
    }

    expect(input.executionData.costOverride).toEqual({
      actionCallIds: ['call-publ1'],
      followUpCallIds: [],
      actions: {},
    })
  })

  it('emits infrastructureCallIds when infrastructureCalls is already serialized', function tolerateSerializedInfrastructureCalls() {
    const malformed = createExecutionData({
      infrastructureCalls: {
        'call-infra1': 'todo_list',
      } as unknown as ExecutionData['infrastructureCalls'],
    })

    expect(() =>
      emitCostAttributionResult({
        ...IDS,
        executionData: malformed,
        totalCost: 1.0,
        sessionWasFree: false,
        attributionPath: 'per_call',
        attribution: perCallAttribution(),
      }),
    ).not.toThrow()

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: { executionData: { infrastructureCallIds: string[] } }
    }

    expect(input.executionData.infrastructureCallIds).toEqual(['call-infra1'])
  })

  it('should pass costsByLabel through verbatim on the attribution payload', function costsByLabel() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({ hadFailures: true }),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'per_call',
      attribution: perCallAttribution({
        costsByLabel: {
          [ReportLabel.ToolFailure]: 0.3,
          [ReportLabel.CausalChain]: 0.2,
        },
      }),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { output } = eventData.data as { output: { attribution: Record<string, unknown> } }

    expect(output.attribution.costsByLabel).toEqual({
      [ReportLabel.ToolFailure]: 0.3,
      [ReportLabel.CausalChain]: 0.2,
    })
  })

  it('should include noValueDelivered when present on executionData', function noValueFlag() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({ noValueDelivered: true }),
      totalCost: 1.0,
      sessionWasFree: true,
      attributionPath: 'no_value',
      attribution: fallbackAttribution({ godaddyCost: 1.0, labels: [ReportLabel.NoOutput] }),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input, output } = eventData.data as {
      input: { executionData: Record<string, unknown> }
      output: Record<string, unknown>
    }

    expect(input.executionData.noValueDelivered).toBe(true)
    expect(output.attributionPath).toBe('no_value')
  })

  it('should include flattened budgetId, budgetSessionId, and reportId at top level', function ids() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData(),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'default',
      attribution: fallbackAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const data = eventData.data as Record<string, unknown>

    expect(data.budgetId).toBe('budget-abc')
    expect(data.budgetSessionId).toBe('session-xyz')
    expect(data.reportId).toBe('report-123')
    expect(data).not.toHaveProperty('session')
  })

  it('should include assessment block when provided', function assessmentBlock() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData(),
      assessment: { intent: 'publish' },
      totalCost: 2.0,
      sessionWasFree: true,
      attributionPath: 'per_call',
      attribution: fallbackAttribution({ godaddyCost: 2.0, labels: [ReportLabel.PublishTask] }),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as { input: { assessment?: Record<string, unknown> } }

    expect(input.assessment).toEqual({ intent: 'publish' })
  })

  it('should strip intent from executionData payload (intent only lives on input.assessment)', function stripIntent() {
    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({ intent: 'publish' }),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'default',
      attribution: fallbackAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as { input: { executionData: Record<string, unknown> } }

    expect(input.executionData).not.toHaveProperty('intent')
  })

  it('should truncate pattern.details and causalChains.errorMessage to schema maxLength', function truncate() {
    const longDetails = 'x'.repeat(3000)
    const longErrorMessage = 'y'.repeat(10000)

    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData({
        patterns: [{ type: 'edit_read_loop', severity: 0.8, callIds: ['call-1'], details: longDetails }],
        causalChains: [{
          triggerCallId: 'call-1',
          triggerTarget: 'Button.tsx',
          errorCallId: 'call-2',
          errorMessage: longErrorMessage,
          fixCallIds: ['call-3'],
        }],
      }),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'default',
      attribution: fallbackAttribution(),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { input } = eventData.data as {
      input: { executionData: { patterns: Array<{ details: string }>; causalChains: Array<{ errorMessage: string }> } }
    }

    expect(input.executionData.patterns[0].details.length).toBe(2048)
    expect(input.executionData.causalChains[0].errorMessage.length).toBe(8192)
  })

  it('should truncate perCall[].patternDetails to schema maxLength', function truncatePerCallDetails() {
    const longDetails = 'z'.repeat(3000)

    emitCostAttributionResult({
      ...IDS,
      executionData: createExecutionData(),
      totalCost: 1.0,
      sessionWasFree: false,
      attributionPath: 'per_call',
      attribution: perCallAttribution({
        perCall: [
          {
            callRequestId: 'call-1',
            cost: 0.5,
            payer: 'godaddy',
            reason: 'pattern_detected',
            label: ReportLabel.ToolFailure,
            patternType: 'edit_read_loop',
            patternDetails: longDetails,
          },
          {
            callRequestId: 'call-2',
            cost: 0.5,
            payer: 'customer',
            reason: 'success',
            label: ReportLabel.General,
          },
        ],
      }),
    })

    const { eventData } = vi.mocked(emitCustomEvent).mock.calls[0][0]
    const { output } = eventData.data as {
      output: { attribution: { perCall: Array<{ patternDetails?: string }> } }
    }

    expect(output.attribution.perCall[0].patternDetails?.length).toBe(2048)
    expect(output.attribution.perCall[1].patternDetails).toBeUndefined()
  })

  it('propagates serializer errors to the caller', function propagatesSerializerErrors() {
    // Force serializeExecutionData to throw by giving failedCallIds an iterator that blows up.
    // Serializer bugs must surface to the caller as code defects, not be silently swallowed.
    const exploding: Iterable<string> = {
      [Symbol.iterator]() {
        throw new Error('serializer bug')
      },
    }
    const executionData = createExecutionData({ failedCallIds: exploding as unknown as Set<string> })

    expect(() =>
      emitCostAttributionResult({
        ...IDS,
        executionData,
        totalCost: 1.0,
        sessionWasFree: false,
        attributionPath: 'per_call',
        attribution: perCallAttribution(),
      }),
    ).toThrow('serializer bug')

    expect(emitCustomEvent).not.toHaveBeenCalled()
  })
})

describe('buildAttributionPayload', function buildSuite() {
  function attributionResult(overrides: Partial<AttributionResult> = {}): AttributionResult {
    const attributions: ItemAttribution[] = [{
      callRequestId: 'call-1',
      cost: 0.7,
      payer: 'godaddy',
      reason: 'tool_error',
      label: ReportLabel.ToolFailure,
    }]
    return {
      customerCost: 0.3,
      godaddyCost: 0.7,
      costsByLabel: new Map<ReportLabel, number>([[ReportLabel.ToolFailure, 0.7]]),
      attributions,
      labels: [ReportLabel.ToolFailure],
      ...overrides,
    }
  }

  it('builds the per-call shape when attributionResult is defined', function perCall() {
    const payload = buildAttributionPayload({
      attributionResult: attributionResult(),
      totalCost: 1.0,
      sessionWasFree: false,
      fallbackLabels: [ReportLabel.ToolFailure],
    })

    expect(payload.customerCost).toBe(0.3)
    expect(payload.godaddyCost).toBe(0.7)
    expect(payload.costsByLabel).toEqual({ [ReportLabel.ToolFailure]: 0.7 })
    expect(payload.labels).toEqual([ReportLabel.ToolFailure])
    expect(payload.perCall).toHaveLength(1)
    expect(payload.perCall[0]?.callRequestId).toBe('call-1')
  })

  it('serializes Map-keyed costsByLabel to a plain object', function costsByLabelShape() {
    const result = attributionResult({
      costsByLabel: new Map<ReportLabel, number>([
        [ReportLabel.ToolFailure, 0.5],
        [ReportLabel.General, 0.2],
      ]),
    })

    const payload = buildAttributionPayload({
      attributionResult: result,
      totalCost: 1.0,
      sessionWasFree: false,
      fallbackLabels: [ReportLabel.ToolFailure],
    })

    expect(payload.costsByLabel).toEqual({
      [ReportLabel.ToolFailure]: 0.5,
      [ReportLabel.General]: 0.2,
    })
  })

  it('builds 100% customer fallback when no attribution result and not free', function customerFallback() {
    const payload = buildAttributionPayload({
      attributionResult: undefined,
      totalCost: 4.5,
      sessionWasFree: false,
      fallbackLabels: [ReportLabel.General],
    })

    expect(payload.customerCost).toBe(4.5)
    expect(payload.godaddyCost).toBe(0)
    expect(payload.labels).toEqual([ReportLabel.General])
    expect(payload.perCall).toEqual([])
    expect(payload.costsByLabel).toBeUndefined()
  })

  it('builds 100% GoDaddy fallback when no attribution result and free', function godaddyFallback() {
    const payload = buildAttributionPayload({
      attributionResult: undefined,
      totalCost: 2.5,
      sessionWasFree: true,
      fallbackLabels: [ReportLabel.NoOutput],
    })

    expect(payload.customerCost).toBe(0)
    expect(payload.godaddyCost).toBe(2.5)
    expect(payload.labels).toEqual([ReportLabel.NoOutput])
    expect(payload.perCall).toEqual([])
  })

  // Per-call branch must read costs and labels from attributionResult, not from
  // sessionWasFree-derived values or the caller's labels parameter. Pins against
  // a regression that introduces sessionWasFree gating inside `if (attributionResult)`.
  it('uses attributionResult costs/labels on per-call branch even when sessionWasFree is true', function perCallIgnoresSessionWasFree() {
    const result = attributionResult({
      customerCost: 0,
      godaddyCost: 1.5,
      costsByLabel: new Map<ReportLabel, number>([[ReportLabel.ToolFailure, 1.5]]),
      labels: [ReportLabel.ToolFailure],
    })

    const payload = buildAttributionPayload({
      attributionResult: result,
      totalCost: 99,
      sessionWasFree: true,
      fallbackLabels: [ReportLabel.General],
    })

    expect(payload.customerCost).toBe(0)
    expect(payload.godaddyCost).toBe(1.5)
    expect(payload.labels).toEqual([ReportLabel.ToolFailure])
  })
})
