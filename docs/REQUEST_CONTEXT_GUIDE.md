# Request Context Guide

## Overview

The AsyncLocalStorage request context system automatically stores user information for the entire request lifecycle without requiring you to pass user data between functions. This is particularly useful for logging and tracking user actions throughout your backend services.

## How It Works

When a request comes through `withCustomerAuth`, the system automatically:
1. Authenticates the user
2. Creates a request context with user information 
3. Stores it in AsyncLocalStorage for the entire request duration
4. Makes it available to any function called during that request

## Usage Examples

### 1. Event-Based Logger

Use the structured logger with event-based logging similar to the agents system:

```typescript
import { logger } from '@/lib/request-context';

// Event-based structured logging
logger.info('api.user.create', 'Creating new user', { 
  name: 'John Doe',
  email: 'john@example.com' 
});

logger.error('api.user.create.error', 'Failed to create user', { 
  error: new Error('Database connection failed'),
  retryCount: 3 
});

logger.warn('api.user.validation', 'User validation warning', {
  field: 'email',
  value: 'invalid-email'
});

// Development output: ℹ️ [customerId:cust-abc reqId:uuid] api.user.create: Creating new user
// Production output: {"timestamp":"2024-01-01T00:00:00.000Z","level":"info","event":"api.user.create","message":"api.user.create: Creating new user","customerId":"cust-abc","requestId":"uuid","data":{"name":"John Doe","email":"john@example.com"}}
```

### 2. Direct Context Access

Access specific user information anywhere in your request:

```typescript
import { RequestContextService } from '@/lib/request-context';

function someBackendFunction() {
  const customerId = RequestContextService.getCustomerId();
  const requestId = RequestContextService.getRequestId();
  
  console.log(`Processing for customer: ${customerId}`);
}
```

### 3. Service Functions

No need to pass user context around - it's automatically available:

```typescript
import { logger } from '@/lib/request-context';

// In your API route
export const GET = withCustomerAuth(async (request, authContext) => {
  // Context is automatically set up here
  await processUserData();
  return NextResponse.json({ success: true });
});

// In any nested function
async function processUserData() {
  logger.info('data.process.start', 'Starting data processing'); // User context included
  await callDatabaseFunction();
}

async function callDatabaseFunction() {
  const customerId = RequestContextService.getCustomerId(); // Still available!
  logger.info('db.operation.start', 'Database operation starting');
}
```

## Available Context Information

The request context includes:
- `customerId`: GoDaddy customer identifier (always available)
- `requestId`: Unique UUID for this specific request

## Event-Based Logging Pattern

Following the agents system pattern, use structured events with domain.action.result format:

### Event Naming Convention
```
domain.action[.result]

Examples:
- api.servers.fetch.start
- api.servers.fetch.success  
- api.servers.fetch.error
- db.user.create
- db.user.update.error
- auth.login.success
- auth.validation.failed
```

### Log Levels
- `debug`: Development debugging information
- `info`: General application flow
- `warn`: Warning conditions that don't stop operation
- `error`: Error conditions that may stop operation
- `fatal`: Critical errors that cause application failure

### Advanced Usage
```typescript
import { logger } from '@/lib/request-context';

// With structured data
logger.info('api.user.create', 'Creating user account', {
  email: user.email,
  role: user.role,
  source: 'registration_form'
});

// With error details
logger.error('db.connection.failed', 'Database connection timeout', {
  error: dbError,
  retryCount: 3,
  timeout: 5000
});

// With performance timing
const start = Date.now();
await processData();
logger.info('data.process.complete', 'Data processing finished', {
  recordsProcessed: 1500,
  duration: Date.now() - start
});

// With tags and metadata
logger.warn('api.rate.limit', 'Rate limit approaching', {
  currentRequests: 95,
  limit: 100,
  windowMinutes: 60
}, {
  tags: ['rate-limiting', 'performance'],
  meta: { alertThreshold: 0.9 }
});
```

## Migration Guide

### Before (Manual Context Passing)
```typescript
async function apiHandler(request: NextRequest, authContext: CustomerAuthContext) {
  const customerId = authContext.user.customerId;
  console.log(`Customer ${customerId}: Processing request`);
  await processData(customerId);
}

async function processData(customerId: string) {
  console.log(`Customer ${customerId}: Processing data`);
  await saveToDatabase(customerId, data);
}

async function saveToDatabase(customerId: string, data: any) {
  console.log(`Customer ${customerId}: Saving to database`);
}
```

### After (Automatic Context)
```typescript
import { logger } from '@/lib/request-context';

async function apiHandler(request: NextRequest, authContext: CustomerAuthContext) {
  logger.info('api.request.start', 'Processing request'); // User context automatic
  await processData();
}

async function processData() {
  logger.info('data.process', 'Processing data'); // User context automatic
  await saveToDatabase(data);
}

async function saveToDatabase(data: any) {
  logger.info('db.save', 'Saving to database'); // User context automatic
}
```

## Integration Points

The context system is automatically enabled for:
- ✅ All API routes using `withCustomerAuth`
- ✅ Any function called within those routes
- ✅ Database operations
- ✅ Service calls
- ✅ Background tasks (within same request)
- ✅ Error handling

## Benefits

1. **Automatic Logging**: All logs include user context without manual setup
2. **No Parameter Drilling**: No need to pass user IDs through function chains
3. **Request Tracking**: Each request gets a unique ID for debugging
4. **Minimal Changes**: Works with existing code patterns
5. **Type Safety**: Full TypeScript support with proper types

## Best Practices

1. **Use Event-Based Logging**: Use structured events with `domain.action.result` format
2. **Include Structured Data**: Pass relevant data objects to provide context
3. **Check Context Availability**: Use `RequestContextService.hasContext()` in shared utilities
4. **Request Correlation**: Use the `requestId` for tracing across services
5. **Error Reporting**: Include full context in error reports for better debugging

## Example: Complete API Route

```typescript
import { withCustomerAuth, type CustomerAuthContext } from '@/lib/customer-auth';
import { logger, RequestContextService } from '@/lib/request-context';

export const POST = withCustomerAuth(async (request: NextRequest, authContext: CustomerAuthContext) => {
  try {
    logger.info('api.user.update.start', 'Starting user data update');
    
    const body = await request.json();
    const result = await updateUserData(body);
    
    logger.info('api.user.update.success', 'User data updated successfully', {
      recordsUpdated: result.count
    });
    return NextResponse.json(result);
  } catch (error) {
    logger.error('api.user.update.error', 'Failed to update user data', { error });
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
});

async function updateUserData(data: any) {
  // User context automatically available - no parameters needed
  const customerId = RequestContextService.getCustomerId();
  
  logger.info('data.validation.start', 'Validating user data', { fields: Object.keys(data) });
  
  // Validation logic here...
  
  logger.info('db.save.start', 'Saving to database');
  return await database.save(data);
}
```

## Troubleshooting

- **Context not available**: Make sure you're within a `withCustomerAuth` wrapped route
- **Missing customer ID**: Check that authentication is working properly
- **Nested async issues**: AsyncLocalStorage works with all Promise-based async operations

## Files Modified

- `src/lib/request-context.ts` - Core context service and logger
- `src/lib/customer-auth.ts` - Integration with auth system
- `src/app/api/servers/route.ts` - Example usage
- `src/lib/REQUEST_CONTEXT_GUIDE.md` - Complete documentation with examples
