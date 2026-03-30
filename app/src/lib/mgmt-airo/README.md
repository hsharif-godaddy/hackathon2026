# mgmt-airo API Client

Low-level HTTP client for the `mgmt-airo` and `mgmt-hosting` APIs.

## Purpose

This client provides a clean, type-safe interface to the mgmt-airo backend API. It handles:

- ✅ HTTP requests with proper authentication
- ✅ Retry logic with exponential backoff
- ✅ Comprehensive error logging
- ✅ Type-safe API methods
- ✅ Hierarchical URL structure (`subscription → system → app`)

It does **NOT** handle:

- ❌ Business logic (that's in `V2ControlPlaneAdapter`)
- ❌ Data mapping/transformation
- ❌ Status translation

## Architecture

```
V2ControlPlaneAdapter
  └─ Uses AiroMgmtClient
       └─ Makes HTTP requests to mgmt-airo
            └─ Proxies to mgmt-hosting
```

## Usage

```typescript
import { AiroMgmtClient } from "@/lib/mgmt-airo";

// Create client
const client = new AiroMgmtClient({
  baseUrl: "https://mgmt.nstk.net",
  jwt: "your-jwt-token",
  maxRetries: 3,
  retryDelayMs: 1000,
});

// Check if customer exists
const customer = await client.checkCustomer();

// Get subscriptions
const subscriptions = await client.getSubscriptions();
const activeSubscription = await client.getActiveSubscription();

// Get systems
const systems = await client.getSystems(subscriptionId);

// Get apps
const apps = await client.getApps(subscriptionId);
const systemApps = await client.getAppsForSystem(subscriptionId, systemId);
const appDetails = await client.getApp(subscriptionId, systemId, appId);

// Create new subscription with app (signup)
const signup = await client.signup({
  datacenter: "sxb1",
  isTrial: true,
  productId: "aab-v1",
  initialPrompt: "create a blog",
  appConfigs: [
    {
      templateName: "default",
      environments: ["dev"],
      variables: { title: "My Blog" },
    },
  ],
});

// Add app to existing subscription
const newApp = await client.createApp(subscriptionId, systemId, {
  appTemplateName: "default",
  environments: ["dev"],
  variables: {
    initialPrompt: "create a blog",
    title: "My Blog",
    airoSubscriptionId: subscriptionId,
  },
});

// Update app
const updated = await client.updateApp(subscriptionId, systemId, appId, {
  variables: { title: "Updated Title" },
});

// Deploy app
const deployed = await client.deployApp(subscriptionId, systemId, appId);

// Delete app
const deleted = await client.deleteApp(subscriptionId, systemId, appId);

// Check job status
const jobStatus = await client.getAiroJobApps(jobId);
```

## API Methods

### Customer

- `checkCustomer()` - Check if customer exists in mgmt-airo

### Subscriptions

- `getSubscriptions()` - Get all subscriptions for customer
- `getActiveSubscription()` - Get first active subscription

### Systems

- `getSystems(subscriptionId)` - Get all systems for a subscription

### Apps

- `getApps(subscriptionId)` - Get all apps across all systems (flat list)
- `getAppsForSystem(subscriptionId, systemId)` - Get apps for specific system
- `getApp(subscriptionId, systemId, appId)` - Get full app details with variables

### Workflows

- `signup(payload)` - Create new subscription + system + app (airo-provision)
- `createApp(subscriptionId, systemId, payload)` - Add app to existing subscription (airo-add-app)

### CRUD Operations

- `updateApp(subscriptionId, systemId, appId, payload)` - Update app details
- `deployApp(subscriptionId, systemId, appId)` - Deploy app
- `deleteApp(subscriptionId, systemId, appId)` - Delete app

### Jobs

- `getAiroJobApps(jobId)` - Get Airo job with tracked apps

## Error Handling

All methods throw errors with detailed messages:

```typescript
try {
  const app = await client.getApp(subId, sysId, appId);
} catch (error) {
  // Error message includes: status code, status text, and response body
  console.error(error.message);
  // Example: "API request failed: 404 Not Found - {"message":"App not found"}"
}
```

## Retry Logic

- **Automatic retries**: 3 attempts by default with exponential backoff (1s, 2s, 4s)
- **404 retries**: Enabled for `getApp()` to handle sync delays
- **Network errors**: All requests retry on network failures
- **Configurable**: Pass `maxRetries` and `retryDelayMs` in config

## Logging

All requests are logged with structured events:

- `mgmt-airo.{method}.request` - Request started
- `mgmt-airo.{method}.response` - Response received
- `mgmt-airo.{method}.success` - Request succeeded
- `mgmt-airo.{method}.error` - Request failed
- `mgmt-airo.{method}.retry` - Retrying after failure
- `mgmt-airo.{method}.auth-error` - Authentication failed (401/403)

## Type Safety

All methods use TypeScript interfaces for requests and responses:

```typescript
interface AiroCreateAppPayload {
  appTemplateName: string;
  environments: string[];
  variables: Record<string, any>;
}

interface AiroCreateAppResponse {
  statusJobId: string;
}
```

See `types.ts` for all available types.

## Testing

Mock the client in tests:

```typescript
const mockClient = {
  getActiveSubscription: vi.fn().mockResolvedValue({ id: "sub123" }),
  getSystems: vi.fn().mockResolvedValue([{ id: "sys123" }]),
  createApp: vi.fn().mockResolvedValue({ statusJobId: "job123" }),
};
```

## Migration from V2ControlPlaneAdapter

The `V2ControlPlaneAdapter` will be refactored to use this client instead of making direct `fetch` calls. This provides:

1. **Better separation** of HTTP logic vs business logic
2. **Easier testing** with mockable client
3. **Code reuse** - other parts of the app can use the client
4. **Type safety** - strong types for all API calls
5. **Consistency** - single source of truth for API structure
