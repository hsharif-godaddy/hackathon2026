/**
 * Stable agent-service identity for all Airo App Builder observability events.
 *
 * Do not change these values casually. They are emitted on every event
 * (`globalContext.agent`) and downstream systems filter, join, and report on
 * them — Langfuse eval datasets/traces and data-lake analytics used by BAs.
 * Renaming or rotating an ID without a coordinated migration breaks historical
 * continuity and breaks existing dashboards/queries.
 *
 * If a change is required, treat it like a schema migration: announce it,
 * update consumer queries, and plan a cutover window — do not edit in place.
 */
export const AGENT_SERVICE_ID = '643efd2d-2dbe-461a-9d2e-188baab483a0'

export const AGENT_SERVICE_NAME = 'Airo App Builder'

export const MULTI_AGENT_SYSTEM = 'airo-app-builder'
