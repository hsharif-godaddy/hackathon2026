/**
 * Emit a cost-attribution-result custom event via the OTel SDK.
 * Must be called within an OTel context with conversationId and agentId set.
 */

import { emitCustomEvent } from '@godaddy/agent-otel-sdk'

import type {
  AssessmentIntent,
  AttributionPath,
  AttributionResult,
  ExecutionData,
  ItemAttribution,
  ReportLabel,
} from './types.js'

const SCHEMA_ID = 'urn:shared:ai:event:/airo-app-builder/cost-attribution-result/v1'

/** Assessment-agent output that influences cost attribution. */
export interface AttributionAssessment {
  intent: AssessmentIntent
}

/** Wire-shape `output.attribution.perCall[]`; widens enum fields to plain string. */
export type AttributionPerCall = Omit<ItemAttribution, 'payer' | 'reason' | 'label'> & {
  payer: string
  reason: string
  label: string
}

/** Wire-shape `output.attribution`. Caller builds this; the emit helper envelopes it. */
export interface AttributionPayload {
  customerCost: number
  godaddyCost: number
  costsByLabel?: Partial<Record<ReportLabel, number>>
  /** Producer typically emits at least one label (defaults to [General]); consumers should handle empty defensively. */
  labels: ReportLabel[]
  /** Empty for non-per-call paths. */
  perCall: AttributionPerCall[]
}

export interface CostAttributionEventContext {
  budgetId: string
  budgetSessionId: string
  /** BMS report identifier returned by createReport. */
  reportId: string
  /** Use emptyExecutionData() when attribution didn't run (e.g. crashed). */
  executionData: ExecutionData
  assessment?: AttributionAssessment
  /** Raw BMS session total (not derivable from `attribution`). */
  totalCost: number
  /** Whether GoDaddy covered 100%. */
  sessionWasFree: boolean
  attributionPath: AttributionPath
  /** Written to `output.attribution` verbatim. */
  attribution: AttributionPayload
}

// Schema maxLength caps. Truncate here so the event always validates; dropped events
// are worse than truncated debug strings for an observability stream.
const MAX_PATTERN_DETAILS = 2048
const MAX_ERROR_MESSAGE = 8192

function truncate(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max)
}

// Defensive: nullish-coalesce Set/Map fields so partial events still flow.
// `intent` is dropped (lives on input.assessment in this event).
function serializeExecutionData(data: ExecutionData) {
  return {
    failedTargets: data.failedTargets,
    hadFailures: data.hadFailures,
    totalSteps: data.totalSteps,
    noValueDelivered: data.noValueDelivered,
    failedCallIds: Array.from(data.failedCallIds ?? []),
    patterns: (data.patterns ?? []).map((p) => ({ ...p, details: truncate(p.details ?? '', MAX_PATTERN_DETAILS) })),
    causalChains: (data.causalChains ?? []).map((c) => ({ ...c, errorMessage: truncate(c.errorMessage ?? '', MAX_ERROR_MESSAGE) })),
    costOverride: {
      actionCallIds: Array.from(data.costOverride?.actionCallIds ?? []),
      followUpCallIds: Array.from(data.costOverride?.followUpCallIds ?? []),
      actions: Object.fromEntries(data.costOverride?.actions ?? new Map()),
    },
    infrastructureCallIds: Array.from(data.infrastructureCallIds ?? []),
  }
}

function serializeAttribution(attribution: AttributionPayload): AttributionPayload {
  return {
    ...attribution,
    perCall: attribution.perCall.map((call) =>
      call.patternDetails === undefined
        ? call
        : { ...call, patternDetails: truncate(call.patternDetails, MAX_PATTERN_DETAILS) },
    ),
  }
}

/** Build the wire-shape `AttributionPayload` from `processBudgetReport` outputs. */
export function buildAttributionPayload(input: {
  attributionResult: AttributionResult | undefined
  /** Used when attributionResult is undefined (fallback branches). */
  totalCost: number
  /** Used when attributionResult is undefined: GoDaddy covers 100% iff true. */
  sessionWasFree: boolean
  /** Producer-decided label for the fallback branch; ignored when attributionResult is defined. */
  fallbackLabels: ReportLabel[]
}): AttributionPayload {
  const { attributionResult, totalCost, sessionWasFree, fallbackLabels } = input
  if (attributionResult) {
    return {
      customerCost: attributionResult.customerCost,
      godaddyCost: attributionResult.godaddyCost,
      costsByLabel: Object.fromEntries(attributionResult.costsByLabel) as Partial<Record<ReportLabel, number>>,
      labels: attributionResult.labels,
      perCall: attributionResult.attributions,
    }
  }
  return {
    customerCost: sessionWasFree ? 0 : totalCost,
    godaddyCost: sessionWasFree ? totalCost : 0,
    labels: fallbackLabels,
    perCall: [],
  }
}

/**
 * Builds the wire-shape event and hands it to the OTel SDK. `emitCustomEvent` is
 * fire-and-forget per its contract, so this function does not catch SDK failures.
 * Serializer throws propagate to the caller as code defects.
 */
export function emitCostAttributionResult(ctx: CostAttributionEventContext): void {
  const { budgetId, budgetSessionId, reportId, executionData, assessment,
          totalCost, sessionWasFree, attributionPath, attribution } = ctx

  const eventData = {
    schemaId: SCHEMA_ID,
    data: {
      budgetId,
      budgetSessionId,
      reportId,
      input: {
        executionData: serializeExecutionData(executionData),
        assessment,
      },
      output: {
        // Classifier system, not per-event status. Future LLM path will set 'llm_based'.
        method: 'rule_based',
        attributionPath,
        totalCost,
        sessionWasFree,
        attribution: serializeAttribution(attribution),
      },
    },
  }

  emitCustomEvent({ eventData })
}
