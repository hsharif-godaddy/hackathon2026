# Structured Logging Guide

This guide explains how to use the structured logging system in the Airo Builder codebase.

## Overview

The logging system uses a hierarchical, event-driven approach with TypeScript interfaces that ensure consistent field naming and proper structure across all log entries.

## Key Principles

1. **Structured Data Only** - No string interpolation in log data, use pure structured fields
2. **Hierarchical Required Fields** - Each domain level enforces specific required context
3. **Consistent Lifecycle Naming** - Use standardized `begin/success/failure` patterns
4. **Type Safety** - All logging uses TypeScript interfaces and helper functions

## Logging Architecture

### Event Naming Convention

Events follow a 3-level hierarchical structure:

```
{domain}.{operation}.{lifecycle}
```

Examples:

- `app.create.begin`
- `app.template.copy.success`
- `app.server.start.failure`

### Required Fields by Domain

Each domain enforces specific required context fields:

- **`app.*`** events → require `appId: string`
- **`docker.*`** events → require `containerId: string`
- **`process.*`** events → require `processId: number`
- **`file.*`** events → require `path: string`

### Lifecycle States

Use consistent lifecycle naming:

- **`begin`** - Operation starting
- **`success`** - Operation completed successfully
- **`failure`** - Operation failed
- **`progress`** - Operation in progress (for long-running tasks)

❌ **Avoid**: `starting`, `started`, `finishing`, `finished`
✅ **Use**: `begin`, `success`, `failure`

## How to Log

### 1. Import Required Helpers

```typescript
import { Logger } from "../../logging/index.js";
import {
  appCreationEvents,
  appServerEvents,
  appTemplateEvents,
} from "../../logging/events/index.js";
```

### 2. Create Logger Instance

```typescript
export class MyService {
  private logger = Logger.create({ component: "my-service" });
}
```

### 3. Use Typed Event Helpers

#### ✅ Good - Structured Logging

```typescript
// Operation start
appCreationEvents.begin(this.logger, {
  appId: "abc123",
  name: "my-app",
  templateVersion: "v8",
  baseDir: "/tmp/airo-app-builder/{appId}",
  port: 3000,
});

// Operation success
appCreationEvents.success(this.logger, {
  appId: "abc123",
  name: "my-app",
  templateVersion: "v8",
  baseDir: "/tmp/airo-app-builder/{appId}",
  port: 3000,
  duration: 1500,
});

// Operation failure
appCreationEvents.failure(this.logger, error, {
  appId: "abc123",
  name: "my-app",
  templateVersion: "v8",
  baseDir: "/tmp/airo-app-builder/{appId}",
  port: 3000,
});
```

#### ❌ Bad - String Interpolation

```typescript
// Don't do this
this.logger.info("app.create.begin", {
  message: `Starting app creation for ${appName} on port ${port}`,
  appId,
  name: appName,
});
```

### 4. Handle Optional Fields Properly

For optional fields like `initialPrompt`, use conditional spreading:

```typescript
appCreationEvents.begin(this.logger, {
  appId: id,
  name: appName,
  templateVersion,
  baseDir,
  port,
  ...(initialPrompt && { initialPrompt }), // Only include if truthy
});
```

### 5. Error Logging

Always use the typed error helpers:

```typescript
try {
  await performOperation();
  appServerEvents.startSuccess(this.logger, { appId, port, ... });
} catch (error) {
  appServerEvents.startFailure(this.logger, error as Error, {
    appId,
    port
  });
  throw error;
}
```

## Available Event Helpers

### App Domain Events

```typescript
import {
  appRepositoryEvents,
  appProcessEvents,
  appCreationEvents,
  appNameEvents,
  appTemplateEvents,
  appDirectoryEvents,
  appSetupEvents,
  appServerEvents,
  appDockerEvents,
  appLifecycleEvents,
  appTransactionEvents,
} from "../../logging/events/index.js";
```

### Example Usage by Category

#### Repository Operations

```typescript
appRepositoryEvents.initBegin(logger, { adapterType: "Docker", duration: 0 });
appRepositoryEvents.initSuccess(logger, {
  adapterType: "Docker",
  duration: 1200,
  startTime: "...",
});
appRepositoryEvents.initFailure(logger, error, { adapterType: "Docker" });
```

#### Process Recovery

```typescript
appProcessEvents.recoverBegin(logger, { processCount: 5 });
appProcessEvents.recoverSuccess(logger, {
  processId: 1234,
  port: 3000,
  status: "recovered",
  wasValid: true,
});
```

#### Template Operations

```typescript
appTemplateEvents.copyBegin(logger, {
  appId,
  templateVersion: "v8",
  operation: "copy",
  path: "/app/path",
  templatePath: "/template/path",
});

appTemplateEvents.copySuccess(logger, {
  appId,
  templateVersion: "v8",
  operation: "copy",
  path: "/app/path",
  templatePath: "/template/path",
});
```

#### Server Operations

```typescript
appServerEvents.startBegin(logger, { appId, port: 3000 });
appServerEvents.startSuccess(logger, {
  appId,
  processId: 1234,
  port: 3000,
  protocol: "http",
  startTime: "2023-...",
  duration: 2000,
});
```

## Creating New Event Types

When adding new operations, follow this pattern:

### 1. Define Interfaces in `events/app.ts`

```typescript
export interface MyNewOperationData extends AppEventData, DurationInfo {
  operationType: "install" | "build" | "deploy";
  version?: string;
}
```

### 2. Add Event Constants

```typescript
export const AppEvents = {
  // ... existing events
  myOperation: {
    begin: "app.my-operation.begin" as const,
    success: "app.my-operation.success" as const,
    failure: "app.my-operation.failure" as const,
  },
};
```

### 3. Create Helper Functions in `events/helpers.ts`

```typescript
export const myOperationEvents = {
  begin: (
    logger: ILogger,
    data: Pick<MyNewOperationData, "appId" | "operationType">,
  ) => {
    logger.info(AppEvents.myOperation.begin, {
      ...data,
      startTime: new Date().toISOString(),
      duration: 0,
    });
  },

  success: (logger: ILogger, data: MyNewOperationData) => {
    logger.info(AppEvents.myOperation.success, data);
  },

  failure: (
    logger: ILogger,
    error: Error,
    data: Partial<MyNewOperationData>,
  ) => {
    log.error(logger, AppEvents.myOperation.failure, error, data);
  },
};
```

### 4. Export from `events/index.ts`

```typescript
export { myOperationEvents } from "./helpers.js";
```

## Best Practices

### ✅ Do

- Use typed helper functions for all logging
- Include all required domain fields (`appId`, `containerId`, etc.)
- Use consistent lifecycle naming (`begin/success/failure`)
- Log operation start, success, and failure states
- Use structured data fields instead of interpolated messages
- Handle optional fields with conditional spreading

### ❌ Don't

- Use `console.log` or direct logger methods with string messages
- Put dynamic content in message strings - use structured fields
- Use inconsistent lifecycle naming (`starting/started/finishing`)
- Skip required domain context fields
- Log sensitive information (passwords, API keys, etc.)
- Use emojis in log output (event names, field values, or messages)

## Migration Guide

When converting existing logging:

### Before

```typescript
console.log(`Starting ${operation} for app ${appId} on port ${port}`);
this.logger.info("operation.started", {
  message: `App ${appId} setup completed in ${duration}ms`,
  appId,
  duration,
});
```

### After

```typescript
appSetupEvents.initBegin(this.logger, { appId });
appSetupEvents.initSuccess(this.logger, {
  appId,
  operation: "setup",
  startTime: startTime,
  duration: duration,
});
```

## Testing Structured Logging

Use the TestHandler for unit tests:

```typescript
import { Logger } from "../../logging/Logger.js";
import { TestHandler } from "../../logging/handlers/TestHandler.js";

describe("My Service", () => {
  let testHandler: TestHandler;
  let logger: Logger;

  beforeEach(() => {
    testHandler = new TestHandler();
    logger = Logger.create({ component: "test" });
    logger.addHandler(testHandler);
  });

  it("should log structured events", () => {
    // Perform operation that logs
    service.performOperation();

    // Assert on structured events
    const events = testHandler.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("app.operation.begin");
    expect(events[0].data.appId).toBe("expected-id");
    expect(events[1].event).toBe("app.operation.success");
  });
});
```

## Environment-Specific Behavior

The logging system automatically adapts to different environments:

- **Development**: Rich console output with colors and expandable content (no emojis)
- **Production**: Structured JSON output suitable for log aggregation
- **Test**: Memory buffer with assertion helpers

No code changes needed - the system detects `NODE_ENV` and configures appropriately.
