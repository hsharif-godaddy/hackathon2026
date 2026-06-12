---
title: Typed event payloads and logger error serialization
date: 2026-05-01
category: best-practices
module: app/instrumentation
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - Writing catch blocks that log errors via logger data arg
  - Defining event payloads for CSP/Signals pipeline
  - Adding new instrumentation functions to instrumentation.ts
tags:
  - logging
  - type-safety
  - error-handling
  - event-instrumentation
  - signals-pipeline
---

# Typed event payloads and logger error serialization

## Context

During PR #3351 (conversion event schema fix), CI review recommended changing `{ error: e instanceof Error ? e.message : String(e) }` to `{ error: e }` to match the "established pattern" at other catch blocks in `instrumentation.ts`. The change was applied but a second review caught that `{ error: e }` produces `{}` in production JSON logs. The "established pattern" turned out to be a pre-existing bug masked by companion `message:` fields.

Separately, the conversion event payload was typed as `Record<string, unknown>`, providing no compile-time safety. Other events in the same file (`ElementChannelEvent`, `EventImpressionData`) already used typed interfaces with literal discriminants. The untyped payload allowed a schema mismatch to ship undetected for 5+ days (session history).

## Guidance

### Logger error serialization

The app logger (`request-context.ts`) has two paths for Error objects:

- **Data path** (2nd arg): lands in `logEvent.data`, serialized by `JSON.stringify`. Error properties (.message, .stack, .name) are non-enumerable, so `JSON.stringify(new Error('x'))` produces `{}`.
- **Error path** (3rd arg `options.error`): extracted to `{ message, stack, name }` by `output()`.

When logging errors in the data object, always extract the message:

```typescript
catch (e) {
  logger.error('instrumentation.fireConversionEvent.failure', {
    error: e instanceof Error ? e.message : String(e),
    orderId,
  });
}
```

The `{ error: e }` pattern at lines 224, 267, 303, 370 are pre-existing bugs that happen to be masked because those catch blocks also include `message:` fields.

### Typed event interfaces

Use interfaces with literal discriminants for instrumentation event payloads:

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

const eventData: SignalsConversionEvent = { ... };
```

This matches `ElementChannelEvent` and `EventImpressionData` in the same file.

## Why This Matters

**Logger serialization**: Empty error objects in logs mean zero diagnostic value for conversion failures. The issue is silent (no runtime error, tests pass because they mock the logger). Found only through CI review and manual inspection of the serialization path.

**Typed payloads**: CSP/Signals pipeline drops events with wrong schema shapes silently. A `Record<string, unknown>` payload allowed a schema mismatch to ship undetected. Typed interfaces surface mismatches at compile time.

## When to Apply

- **Every catch block** that logs via the data arg (2nd parameter). The `{ error: e }` pattern is never correct for this logger unless you also set `options.error` (3rd parameter)
- **Every new instrumentation event**. Before writing `Record<string, unknown>` for any CSP/Signals payload
- **Incrementally** when touching untyped event code. Don't batch-refactor; fix as you go

## Examples

### Error serialization

```typescript
// BAD: produces { "error": {} } in production JSON logs
logger.error('instrumentation.fireConversionEvent.failure', { error: e });

// GOOD: produces { "error": "Cannot read property 'push' of undefined" }
logger.error('instrumentation.fireConversionEvent.failure', {
  error: e instanceof Error ? e.message : String(e),
  orderId,
});
```

### Typed event payloads

```typescript
// BAD: typo in schema or missing fields not caught
const eventData: Record<string, unknown> = {
  schema: 'add_conversion',  // typo, silently dropped
  data: { ... },
};

// GOOD: compile-time error on schema typo or missing fields
const eventData: SignalsConversionEvent = {
  schema: 'add_conversion',
  // TS2322: Type '"add_conversion"' is not assignable to type '"add_generic_conversion"'
};
```

## Related

- `LOGGING-GUIDE.md` for `{domain}.{operation}.{lifecycle}` naming convention
- `docs/CLIENT-SIDE-TOOLS.md` for the error extraction pattern in WebSocket action executors
- `docs/solutions/integration-issues/conversion-event-wrong-schema-2026-05-01.md` for the original schema mismatch bug
- `docs/solutions/design-patterns/signalsdatalayer-conversion-event-pattern-2026-04-23.md` for the SCC dedup pattern
