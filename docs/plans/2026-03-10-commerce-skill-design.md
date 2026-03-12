# Commerce Skill: Agent-to-Skill Rearchitecture

Replace the Commerce Agent (sub-agent with handoffs and ~1,000 lines of prompts) with a Commerce Skill that runs within the Develop Agent. Deterministic workflows execute in code; the agent only handles user interaction and site customisation.

## Motivation

The current Commerce Agent has three problems:

1. **Reliability** — Workflow steps (OAuth, store creation, product fetching, env var configuration, dependency installation) are prompted into existence via ~1,000 lines of system prompts. Each step requires LLM reasoning that can fail or deviate.
2. **Token cost** — The agent loads ~1,000 lines of prompts, reasons through each API call, formats handoff instructions, and the Develop Agent re-parses those instructions. Most of this is wasted on deterministic operations.
3. **Architecture fit** — The Commerce Agent is a sub-agent that hands off to the Develop Agent via a brittle protocol with hardcoded string instructions. The skill system is a better fit: it runs within the Develop Agent, provides templates for deterministic installation, and exposes tools for code-driven workflows.

## Design Principles

- **Code for deterministic workflows, agent for creative decisions.** Store setup, product fetching, template installation, and env var configuration are fixed sequences. How the storefront looks on the user's site is a creative decision.
- **Templates as default, agent can customise.** A working storefront is installed deterministically. The agent then modifies layout, styling, and page structure based on user preferences.
- **Minimal prompt surface.** The skill.md provides ~30 lines of guidance (when to use, workflow order, what not to touch). Workflow knowledge lives in tool implementations.

## Skill Structure

```
agents/src/skills/commerce/
├── skill.md                              # Agent guidance (~30 lines)
├── templates/
│   ├── components/
│   │   ├── ProductGrid.tsx               # Catalog grid display
│   │   ├── ProductDetails.tsx            # Single product with variant selector
│   │   ├── Cart.tsx                      # Cart with checkout handler
│   │   └── GoDaddyProvider.tsx           # Provider wrapper reading env vars
│   ├── pages/
│   │   ├── Shop.tsx                      # Storefront page
│   │   └── Product.tsx                   # Single product page
│   └── api/
│       └── commerce/
│           └── create-checkout-session/
│               └── POST.ts              # Checkout backend route
└── tools/
    └── index.ts                          # 5 skill tools
```

Templates are extracted from the code examples currently embedded in prompt files. They use `@godaddy/react` components and are pre-configured to read from `VITE_` env vars.

## skill.md

```markdown
---
name: commerce
description: Set up GoDaddy Commerce storefronts with product catalogs and checkout
dependencies:
  - "@godaddy/react"
  - "@godaddy/localizations"
  - "@tanstack/react-query"
---

# Commerce Skill

## When to Use

- User asks to sell products, set up a store, add a shop, or show their catalog
- User mentions GoDaddy Commerce, products, checkout, or payments

## Workflow

1. Call `commerce__setup_store` — handles OAuth + store creation automatically
2. Call `commerce__fetch_catalog` — returns all products with SKU data
3. Call `commerce__install_storefront` — installs templates, env vars, and dependencies
4. Customise the installed components based on user preferences (layout, styling, pages)

## After Installation

The installed templates include ProductGrid, ProductDetails, Cart, and GoDaddyProvider.
They are pre-configured with the store's data. You can:

- Move components between pages
- Adjust styling and layout
- Add/remove product display sections
- The checkout flow works out of the box — do not modify the Cart.onCheckout handler

## Product Management

Use `commerce__manage_products` to create, update, or delete products when the user asks.
Use `commerce__get_orders` to fetch order data when the user asks.
```

## Skill Tools

### Shared Auth Middleware

All tools use a shared `withCommerceAuth` wrapper that eliminates the repeated auth boilerplate (currently duplicated 8 times across tools):

```typescript
async function withCommerceAuth<T>(
  appId: string,
  fn: (accessToken: string, customerId: string) => Promise<T>,
): Promise<ToolResult<T>> {
  const { accessToken } = await AuthService.getAccessToken({ appId });
  const customerId = getCustomerIdFromAccessToken(accessToken);
  return ok(await fn(accessToken, customerId));
  // AuthRequiredError caught at tool boundary → needAuth() response
}
```

### Tool 1: `commerce__setup_store`

Complete store onboarding workflow — replaces multi-step agent reasoning with a single deterministic code path.

**Steps executed in code:**

1. Check for valid OAuth token → trigger interactive OAuth if missing
2. Look up existing store for this customer → skip creation if found
3. Create store via GoDaddy onboarding API
4. Enable Catalog V2
5. Enable GoDaddy Payments
6. Return store metadata (storeId, channelId, management URL)

**Parameters:** `firstName`, `lastName`, `email`, `storeName` (optional — only needed if no existing store)

**Returns:** `{ storeId, channelId, manageUrl }` or `needAuth` with redirect URL

### Tool 2: `commerce__fetch_catalog`

Fetches the complete product catalog with automatic pagination — replaces the agent manually re-calling the search tool with cursor values.

**Steps executed in code:**

1. Get store from context (storeId from previous setup or lookup)
2. Paginate through all products automatically (cursor loop in code)
3. Return structured product array with SKU IDs

**Parameters:** `storeId`, `query` (optional filter)

**Returns:** `{ products: [{ id, label, description, type, skus: [{ id, code, name, price }] }], totalCount }`

### Tool 3: `commerce__install_storefront`

The key workflow tool — replaces the entire handoff protocol. Executes the integration that the current system describes across ~500 lines of prompts.

**Steps executed in code:**

1. Install commerce templates from `templates/` directory to the app
2. Read `GODADDY_OAUTH_CLIENT_ID` from `/alloc/config.json`
3. Read `GODADDY_API_BASE_URL` from agents env, strip protocol to get hostname
4. Write `VITE_GODADDY_CLIENT_ID` and `VITE_GODADDY_API_HOST` to app `.env`
5. Inject `storeId` and `channelId` into GoDaddyProvider template
6. Install npm dependencies
7. Return list of installed files and configuration summary

**Parameters:** `storeId`, `channelId`

**Returns:** `{ installedFiles: string[], envVarsWritten: string[], dependenciesInstalled: string[] }`

### Tool 4: `commerce__manage_products`

CRUD operations for products, SKUs, inventory, and media. This remains agent-directed because operations vary by user intent.

**Actions:** `createProduct`, `updateProduct`, `deleteProduct`, `updateSku`, `updatePrice`, `adjustInventory`, `stockInventory`, `addMedia`, `removeMedia`, `getLocations`, `createLocation`

**Parameters:** Action-specific (validated by Zod discriminated union)

### Tool 5: `commerce__get_orders`

Read-only order retrieval.

**Parameters:** `storeId`, `orderId` (optional — omit for all orders)

**Returns:** Order data with line items, statuses, billing/shipping info

## Error Handling and Retry

### API Retry

Add retry with exponential backoff and jitter to `godaddy-commerce.ts`:

- Retry on transient failures: 429, 500, 502, 503, 504
- 3 attempts max, starting at 1s delay
- Non-retryable errors (400, 401, 403, 404) fail immediately
- 401 errors caught by `withCommerceAuth` → converted to `needAuth()`

### Workflow-Level Errors

Tools return structured partial-success results instead of failing opaquely:

- `commerce__setup_store`: If Catalog V2 fails after store creation, return `{ storeId, errors: ['catalog_v2_enablement_failed'] }` — the store exists and is usable
- `commerce__install_storefront`: If templates install but npm fails, return `{ installedFiles: [...], failedDependencies: [...] }` — agent can report to user and retry

### Response Validation

Add Zod schemas for GoDaddy API responses at the `godaddy-commerce.ts` boundary. Parse with `.safeParse()` so malformed API responses become clear errors instead of silent type mismatches.

## What Gets Removed

| File/Component                                                   | Reason                                            |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| `agents/src/agents/commerce-agent.ts`                            | Replaced by skill                                 |
| `agents/src/prompts/commerce/core.md` (~604 lines)               | Workflow logic moved to code                      |
| `agents/src/prompts/commerce/handoff-protocol.md` (~273 lines)   | Replaced by `install_storefront` tool             |
| `agents/src/prompts/commerce/communication.md` (~148 lines)      | Unnecessary with minimal skill.md                 |
| `agents/src/prompts/develop/commerce.md` (~192 lines)            | Replaced by skill.md                              |
| `agents/src/tools/ai-lib-tools/commerce-tools.ts` (~1,409 lines) | Rewritten as skill tools                          |
| Commerce agent registration in `ai-lib-agents/index.ts`          | No longer a sub-agent                             |
| Commerce handoff config in `develop-agent.ts`                    | No longer uses handoffs                           |
| `ENABLE_COMMERCE_AGENT` feature flag                             | Unnecessary — skills are discovered automatically |

## What Gets Kept

| File/Component                             | Changes                                     |
| ------------------------------------------ | ------------------------------------------- |
| `agents/src/lib/godaddy-commerce.ts`       | Add retry logic and response validation     |
| `agents/src/lib/godaddy-commerce-types.ts` | No changes                                  |
| `agents/src/services/auth-service.ts`      | No changes — consumed by `withCommerceAuth` |

## What Gets Created

| File                                                                                | Purpose                                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `agents/src/skills/commerce/skill.md`                                               | ~30 lines of agent guidance                                                   |
| `agents/src/skills/commerce/tools/index.ts`                                         | 5 skill tools with `withCommerceAuth`                                         |
| `agents/src/skills/commerce/templates/components/*.tsx`                             | Pre-built storefront components                                               |
| `agents/src/skills/commerce/templates/pages/*.tsx`                                  | Shop and product pages                                                        |
| `agents/src/skills/commerce/templates/api/commerce/create-checkout-session/POST.ts` | Checkout backend route                                                        |
| Tests for skill tools                                                               | Unit tests for each tool's happy path, auth-required path, and error handling |
| Tests for retry logic                                                               | Unit tests for backoff and transient failure handling                         |

## Token Cost Comparison

| Component                            | Current (tokens, approximate) | Proposed                  |
| ------------------------------------ | ----------------------------- | ------------------------- |
| Commerce Agent system prompt         | ~6,000                        | 0 (no sub-agent)          |
| Develop Agent commerce.md            | ~1,200                        | 0 (removed)               |
| Commerce skill.md (loaded on demand) | —                             | ~300                      |
| Agent reasoning per API call         | ~500 per step x ~5 steps      | 0 (code-driven)           |
| Handoff instruction generation       | ~2,000                        | 0 (template installation) |
| Develop Agent parsing handoff        | ~1,000                        | 0                         |
| **Total per commerce interaction**   | **~12,700**                   | **~300**                  |

## Implementation Order

1. Add retry logic and response validation to `godaddy-commerce.ts`
2. Build the skill (templates, tools, skill.md)
3. Remove the Commerce Agent, prompt files, old tools, and `ENABLE_COMMERCE_AGENT` flag
4. Test end-to-end
