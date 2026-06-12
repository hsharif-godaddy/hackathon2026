---
title: Conversion event silently dropped due to wrong Confluence schema
date: 2026-05-01
category: integration-issues
module: app
problem_type: integration_issue
component: frontend_stimulus
symptoms:
  - Conversion events silently dropped by Signals pipeline for 5+ days
  - No errors in browser console or application logs
  - No conversion events recorded in downstream analytics despite active signups
root_cause: wrong_api
resolution_type: code_fix
severity: high
last_updated: 2026-05-01
tags:
  - analytics
  - conversion-event
  - signalsdatalayer
  - scc-interface
  - event-bus-schema
  - silent-failure
---

# Conversion event silently dropped due to wrong Confluence schema

## Problem

The `fireConversionEvent` function in `app/src/utils/instrumentation.ts` was built against the wrong Confluence documentation page. Events pushed to `_signalsDataLayer` were silently dropped by the Signals pipeline for 5+ days because the payload structure didn't match the SCC interface schema.

## Symptoms

- No conversion events appearing in downstream analytics dashboards despite active free trial signups
- No client-side errors (`_signalsDataLayer` is an array that accepts any shape)
- No server-side errors (push always succeeds)
- Searching `data.conversionId.keyword` in Elasticsearch returned zero results

## What Didn't Work

- **Searched the wrong Elasticsearch field.** The CSP/EXP team initially searched `data.conversionId.keyword` but the event doesn't send a `conversionId` field. The events go through the GoDaddy Signals pipeline, not `_expDataLayer`.
- **Used the CSP event bus schema as the implementation spec.** The "Conversion Event" Confluence page (page 3519971547) documents the event bus schema for server-side direct push to CSP. The implementation followed it faithfully, including `conversion` wrapper, `eventCreationTimestamp`, and `virtualOrderId`. All unit tests passed because `_signalsDataLayer.push()` accepts any shape. The downstream validation failure is silent.
- **GoDaddyAgent hallucinated field names.** When asked about the schema during planning, the GoDaddyAgent chatbot returned fabricated fields (`conversionType`, `customerId`, `value`) that don't exist in either documented schema, further muddying the investigation (session history).
- **CI review recommended `{ error: e }` instead of message extraction.** Changing the catch block from `e instanceof Error ? e.message : String(e)` to `{ error: e }` produced `{}` in production JSON logs because Error properties are non-enumerable. Had to revert in a follow-up commit (session history).

## Solution

Two Confluence pages document different layers of the same event system. The correct one for client-side browser push is the [add_generic_conversion SCC interface](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519683741/add_generic_conversion) (page 3519683741), not the [Conversion Event bus schema](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519971547) (page 3519971547).

**Before (wrong, event bus schema):**

```typescript
{
  schema: 'add_generic_conversion',
  data: {
    eventCreationTimestamp: new Date().toISOString(),
    conversion: {
      area: 'airo-builder',
      revenue: 'freetrial',
      product: 'airo-builder-freemium',
      action: 'signup',
    },
    ...(orderId ? { virtualOrderId: orderId } : {}),
  },
}
```

**After (correct, SCC interface with typed interface):**

```typescript
interface SignalsConversionEvent {
  schema: 'add_generic_conversion';
  version: 'v1';
  data: {
    area: string;
    product: string;
    revenue: string;
    action: string;
    properties: Record<string, string>;
  };
}

const eventData: SignalsConversionEvent = {
  schema: 'add_generic_conversion',
  version: 'v1',
  data: {
    area: 'airo-builder',
    product: 'airo-builder-freemium',
    revenue: 'freetrial',
    action: 'signup',
    properties: orderId ? { virtual_order_id: orderId } : {},
  },
};
```

Key changes: added `version: 'v1'`, flattened fields under `data` (removed `conversion` wrapper), removed `eventCreationTimestamp` (SCC client handles it), moved orderId to `properties.virtual_order_id`, made `properties` always present (required field per the CSP team), added typed `SignalsConversionEvent` interface for compile-time schema validation.

## Why This Works

The SCC (Signals Collection Client) is a browser-side library that accepts events via `_signalsDataLayer.push()`, enriches them with global context (customer data, session info, timestamps), validates against registered schemas, and forwards to the Signals pipeline.

The two Confluence pages document different layers:

| Page | Name | Layer | Use when... |
|------|------|-------|-------------|
| 3519971547 | Conversion Event | Event bus schema (post-SCC enrichment) | Pushing server-side directly to CSP service |
| 3519683741 | add_generic_conversion | SCC interface (producer push format) | Pushing client-side via `_signalsDataLayer` in browser |

The SCC client handles the transformation from interface schema to event bus schema automatically. Application code should never manually construct the event bus format.

## Prevention

- **Always use the [add_generic_conversion SCC interface](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519683741/add_generic_conversion) page for client-side `_signalsDataLayer` events.** The [Conversion Event](https://godaddy-corp.atlassian.net/wiki/spaces/CKPT/pages/3519971547) page is the event bus schema for server-side push only.
- **Cross-reference GoDaddyAgent output against official Confluence docs.** The chatbot hallucinated field names during planning. Treat it as a starting point, not an authoritative source.
- **Validate event delivery end-to-end.** `_signalsDataLayer.push()` succeeds on any shape. Unit tests that verify the push happened do not prove the payload will pass downstream validation. After deploying conversion events, verify they appear in the analytics pipeline within 24 hours.
- **Use typed interfaces with literal discriminants for event payloads.** `SignalsConversionEvent` catches schema mismatches at compile time. See `docs/solutions/best-practices/typed-event-payloads-and-logger-error-serialization-2026-05-01.md` for the general pattern.
- **Always extract error messages in logger data arguments.** Use `e instanceof Error ? e.message : String(e)`, never `{ error: e }`. Error properties are non-enumerable; `JSON.stringify(new Error('x'))` produces `{}`. See the typed-event-payloads doc for details.
- **WSB/vnext production pattern is a reliable reference.** Their free trial conversion (`{"area":"vnext","revenue":"freetrial","product":"gocentral","action":"signup"}`) has been working in production and follows the same SCC interface.

## Related Issues

- PR [#3351](https://github.com/gdcorp-partners/airo-app-builder/pull/3351): fix: conversion event payload schema
- PR [#3113](https://github.com/gdcorp-partners/airo-app-builder/pull/3113): feat: generic conversion event for free trial signup (original implementation)
- `docs/solutions/design-patterns/signalsdatalayer-conversion-event-pattern-2026-04-23.md` (pattern doc, updated with correct schema)
- Slack thread: #airo-ai-builder-squad-paywall, 2026-05-01
