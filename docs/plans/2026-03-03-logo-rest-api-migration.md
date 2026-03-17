# Logo Generation REST API Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the browser-proxied MCP pattern for logo generation with a direct server-to-server REST API call from agents to the logo API, with S2S auth, LiteLLM budget passthrough, and brand data enrichment from shared memory.

**Architecture:** The agents server calls `POST /api/logo` on the logo-agent API directly using AWS IAM S2S auth (via `gd-auth-client` IamTokenClient, already available in `ai-lib`). Customer identity is passed via `x-customer-id` header. LiteLLM budget metadata is passed via `x-budget-user-id` and `x-budget-id` headers, which the logo API forwards to GoCode. The media skill tool pre-populates brand inputs from the agent's memory system (`app.title`, `app.description`) and app plan (color palette), reducing redundant user prompts.

**Tech Stack:** TypeScript, Express, `gd-auth-client` (IamTokenClient), `@godaddy/agent-sdk` (GoCode client), Zod, Vitest

**Repos:**
- `airo-app-builder` — agents service + ai-lib (primary)
- `gai-logo-agent` — logo API (secondary, S2S auth + budget passthrough)

---

## Track A: Logo API Changes (gai-logo-agent)

These tasks are in the `gai-logo-agent` repository.

---

### Task 1: Add S2S Auth Support to Logo API Auth Middleware

**Context:** The logo API auth middleware (`packages/api/src/middleware/auth.ts`) currently only accepts `idp` tokens. We need it to also accept `awsiam` tokens so the agents server can call it directly using AWS IAM credentials. When using S2S auth, the customer is identified via `x-customer-id` header instead of JWT claims.

**Files:**
- Modify: `gai-logo-agent/packages/api/src/middleware/auth.ts`
- Modify: `gai-logo-agent/packages/api/src/index.ts` (route-level auth config)
- Test: `gai-logo-agent/packages/api/src/middleware/__tests__/auth.test.ts`

**Step 1: Write failing test for awsiam auth acceptance**

```typescript
describe('auth middleware - S2S support', () => {
  it('should accept awsiam auth and extract customerId from x-customer-id header', async () => {
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer <valid-awsiam-token>',
        'x-customer-id': 'cust-123',
        'x-app-key': 'airo-builder',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await authMiddleware({ types: ['idp', 'awsiam'] })(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.locals.user).toBeDefined();
    expect(res.locals.user.customerId).toBe('cust-123');
  });

  it('should reject awsiam auth without x-customer-id header', async () => {
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer <valid-awsiam-token>',
        // no x-customer-id
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await authMiddleware({ types: ['idp', 'awsiam'] })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('should reject awsiam auth without trusted x-app-key', async () => {
    const req = createMockRequest({
      headers: {
        authorization: 'Bearer <valid-awsiam-token>',
        'x-customer-id': 'cust-123',
        'x-app-key': 'unknown-app',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await authMiddleware({ types: ['idp', 'awsiam'] })(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd gai-logo-agent && pnpm --filter api test -- auth.test`
Expected: FAIL — tests fail because awsiam isn't configured

**Step 3: Implement S2S auth handling**

In `packages/api/src/middleware/auth.ts`, update the middleware factory:

```typescript
// Add trusted app keys for S2S callers
const TRUSTED_S2S_APP_KEYS = ['airo-builder', 'airo-app-builder'];

// In the auth middleware function, after existing user extraction:
function extractCustomerFromS2SHeaders(req: Request): { customerId: string } | null {
  const appKey = req.headers['x-app-key'] as string | undefined;
  const customerId = req.headers['x-customer-id'] as string | undefined;

  if (!appKey || !TRUSTED_S2S_APP_KEYS.includes(appKey)) {
    return null;
  }
  if (!customerId) {
    return null;
  }
  return { customerId };
}

// In the user resolution logic, when auth type is 'awsiam':
if (user.type === 'awsiam') {
  const s2sContext = extractCustomerFromS2SHeaders(req);
  if (!s2sContext) {
    res.status(400).json({ error: 'x-customer-id header required for S2S auth' });
    return;
  }
  // Attach customerId to user object for downstream handlers
  (user as any).customerId = s2sContext.customerId;
  (user as any).shopperId = s2sContext.customerId; // For entitlement lookups
}
```

**Step 4: Update route auth config**

In `packages/api/src/index.ts`, update the global auth middleware to accept both types:

```typescript
// Change from:
app.use(authMiddleware());
// To:
app.use(authMiddleware({ types: ['idp', 'awsiam'] }));
```

**Step 5: Run tests to verify they pass**

Run: `cd gai-logo-agent && pnpm --filter api test -- auth.test`
Expected: PASS

**Step 6: Commit**

```bash
cd gai-logo-agent
git add packages/api/src/middleware/auth.ts packages/api/src/index.ts packages/api/src/middleware/__tests__/auth.test.ts
git commit -m "feat: add awsiam S2S auth support with x-customer-id header"
```

---

### Task 2: Add LiteLLM Budget Metadata Passthrough to Image Generation

**Context:** The logo API calls GoCode via `getGoCodeOpenAIClient().images.generate()` but doesn't pass any LiteLLM metadata. We need to accept budget headers from the caller and forward them to GoCode so generation costs are billed against the customer's budget.

**Files:**
- Modify: `gai-logo-agent/packages/api/src/logo-v2/imageGeneration.ts`
- Modify: `gai-logo-agent/packages/api/src/logo-v2/types.ts`
- Modify: `gai-logo-agent/packages/api/src/logo-v2/index.ts` (pass budget through to image generation)
- Modify: `gai-logo-agent/packages/api/src/handlers/generateLogo.ts` (extract budget headers)
- Test: `gai-logo-agent/packages/api/src/logo-v2/__tests__/imageGeneration.test.ts`

**Step 1: Write failing test for budget metadata passthrough**

```typescript
describe('generateImages - budget metadata', () => {
  it('should pass litellm_metadata header when budget info provided', async () => {
    const generateSpy = vi.spyOn(mockClient.images, 'generate');

    await generateImages(['test prompt'], {
      budgetUserId: 'budget-user-123',
      budgetId: 'budget-456',
    });

    expect(generateSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-litellm-metadata': expect.stringContaining('budget-user-123'),
        }),
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd gai-logo-agent && pnpm --filter api test -- imageGeneration.test`
Expected: FAIL — no budget metadata being passed

**Step 3: Add budget fields to LogoGenerationConfig**

In `packages/api/src/logo-v2/types.ts`, add to the config interface:

```typescript
export interface LogoGenerationConfig {
  // ... existing fields ...

  /** LiteLLM budget user ID for cost attribution */
  budgetUserId?: string;
  /** LiteLLM budget ID for cost tracking */
  budgetId?: string;
}
```

**Step 4: Update image generation to pass budget metadata**

In `packages/api/src/logo-v2/imageGeneration.ts`, update `_generateImages`:

```typescript
async function _generateImages(
  prompts: string[],
  config: Partial<LogoGenerationConfig> = {}
): Promise<BatchImageGenerationResult> {
  const imageModel = config.imageModel || DEFAULT_IMAGE_MODEL;
  const useFallback = config.useFallback ?? true;
  const timeoutMs = config.imageTimeoutMs || 60000;

  // Build request options with budget metadata if provided
  const requestOptions: Record<string, unknown> = {};
  if (config.budgetUserId) {
    const litellmMetadata: Record<string, unknown> = {
      user: config.budgetUserId,
    };
    if (config.budgetId) {
      litellmMetadata.budget_id = config.budgetId;
    }
    requestOptions.headers = {
      'x-litellm-metadata': JSON.stringify(litellmMetadata),
    };
  }

  // ... rest of existing logic, pass requestOptions to generateSingleImage ...
}
```

Update `generateSingleImage` to accept and forward request options:

```typescript
async function generateSingleImage(
  prompt: string,
  model: ImageGenerationModel,
  timeoutMs: number,
  requestOptions?: Record<string, unknown>
): Promise<Buffer> {
  const client = getGoCodeOpenAIClient();

  const response = await Promise.race([
    client.images.generate(
      { model, prompt, ...DEFAULT_IMAGE_PARAMS },
      requestOptions  // Forward budget metadata headers
    ),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Image generation timeout after ${String(timeoutMs)}ms`)), timeoutMs);
    })
  ]);

  const imageData = response.data?.[0];
  if (!imageData?.b64_json) {
    throw new Error('No image data in response');
  }
  return Buffer.from(imageData.b64_json, 'base64');
}
```

**Step 5: Extract budget headers in the REST handler**

In `packages/api/src/handlers/generateLogo.ts`, in the `handleGenerateLogo` function:

```typescript
// After input validation, before calling generateLogosV2:
const budgetUserId = req.headers['x-budget-user-id'] as string | undefined;
const budgetId = req.headers['x-budget-id'] as string | undefined;

// Pass to generation function
const result = await generateLogosV2(validatedInput, {
  customerId,
  token,
  budgetUserId,
  budgetId,
});
```

**Step 6: Thread budget config through `generateLogosV2` to `generateImages`**

In `packages/api/src/logo-v2/index.ts`, pass the budget fields from the options to the image generation config:

```typescript
const imageResults = await generateImages(prompts, {
  imageModel: config.imageModel,
  // ... existing config fields ...
  budgetUserId: options.budgetUserId,
  budgetId: options.budgetId,
});
```

**Step 7: Run tests to verify they pass**

Run: `cd gai-logo-agent && pnpm --filter api test -- imageGeneration.test`
Expected: PASS

**Step 8: Commit**

```bash
cd gai-logo-agent
git add packages/api/src/logo-v2/imageGeneration.ts packages/api/src/logo-v2/types.ts packages/api/src/logo-v2/index.ts packages/api/src/handlers/generateLogo.ts packages/api/src/logo-v2/__tests__/imageGeneration.test.ts
git commit -m "feat: pass LiteLLM budget metadata through to GoCode image generation"
```

---

## Track B: App Builder Changes (airo-app-builder)

These tasks are in the `airo-app-builder` repository.

---

### Task 3: Create LogoService for Server-Side Logo API Calls

**Context:** Create a service class following the `GettyUploadService` pattern. It calls the logo API REST endpoint directly from the agents server using S2S auth via `getS2SToken()` from ai-lib's s2s-auth utils. Customer identity and budget info are passed as headers.

**Files:**
- Create: `agents/src/services/LogoService.ts`
- Test: `agents/src/services/__tests__/LogoService.test.ts`

**Reference pattern:** `agents/src/services/GettyUploadService.ts`

**Step 1: Write failing test for LogoService**

```typescript
// agents/src/services/__tests__/LogoService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the S2S auth module
vi.mock('@airo/ai-lib/utils/s2s-auth', () => ({
  getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LogoService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOGO_API_URL = 'https://logo-agent.mvci.api.dev-godaddy.com';
  });

  it('should call POST /api/logo with correct headers and body', async () => {
    const { logoService } = await import('../LogoService');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        sessionId: 'sess-123',
        entitled: true,
        logos: [{ id: 'logo-1', transparentUrl: 'https://example.com/logo.png', solidUrl: 'https://example.com/logo-solid.png', mockupUrl: 'https://example.com/mockup.png' }],
      }),
    });

    const result = await logoService.generateLogos({
      brandName: 'Test Brand',
      brandDescription: 'A test brand',
      style: 'flat',
      customerId: 'cust-123',
      budgetUserId: 'budget-user-456',
      budgetId: 'budget-789',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://logo-agent.mvci.api.dev-godaddy.com/api/logo',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-app-key': 'airo-builder',
          'x-customer-id': 'cust-123',
          'x-budget-user-id': 'budget-user-456',
          'x-budget-id': 'budget-789',
          'Authorization': 'Bearer mock-s2s-token',
        }),
      })
    );

    expect(result).toEqual({
      sessionId: 'sess-123',
      entitled: true,
      logos: [{ id: 'logo-1', transparentUrl: 'https://example.com/logo.png', solidUrl: 'https://example.com/logo-solid.png', mockupUrl: 'https://example.com/mockup.png' }],
    });
  });

  it('should return error result on API failure', async () => {
    const { logoService } = await import('../LogoService');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const result = await logoService.generateLogos({
      brandName: 'Test',
      brandDescription: 'Test',
      style: 'flat',
      customerId: 'cust-123',
    });

    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "LogoService"`
Expected: FAIL — module not found

**Step 3: Implement LogoService**

```typescript
// agents/src/services/LogoService.ts
import { getS2SToken } from '@airo/ai-lib/utils/s2s-auth';
import { getLogger } from '../utils/logger';

const logger = getLogger('logo-service');

export interface LogoGenerateInput {
  brandName: string;
  brandDescription: string;
  style: string;
  brandTagline?: string;
  brandColors?: string;
  brandPersonality?: string;
  brandAudience?: string;
  styleDescription?: string;
  symbol?: string;
  count?: number;
  refinementLogoUrl?: string;
  // Caller context (not sent in body)
  customerId: string;
  budgetUserId?: string;
  budgetId?: string;
}

export interface ProcessedLogo {
  id: string;
  transparentUrl: string;
  solidUrl: string;
  mockupUrl: string;
}

export interface LogoGenerateResult {
  sessionId: string;
  entitled: boolean;
  logos: ProcessedLogo[];
}

function getLogoApiBaseUrl(): string {
  if (process.env.LOGO_API_URL) {
    return process.env.LOGO_API_URL;
  }
  const apiUrl = process.env.GODADDY_API_BASE_URL || '';
  if (apiUrl.includes('dev-godaddy.com')) return 'https://logo-agent.mvci.api.dev-godaddy.com';
  if (apiUrl.includes('test-godaddy.com')) return 'https://logo-agent.mvci.api.test-godaddy.com';
  return 'https://logo-agent.mvci.api.godaddy.com';
}

class LogoService {
  private readonly appKey = 'airo-builder';

  async generateLogos(input: LogoGenerateInput): Promise<LogoGenerateResult | null> {
    const baseUrl = getLogoApiBaseUrl();
    const url = `${baseUrl}/api/logo`;

    logger.info('logo.generate.begin', {
      brandName: input.brandName,
      style: input.style,
      count: input.count ?? 4,
      customerId: input.customerId,
    });

    try {
      const token = await getS2SToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'x-app-key': this.appKey,
        'x-customer-id': input.customerId,
      };

      if (input.budgetUserId) {
        headers['x-budget-user-id'] = input.budgetUserId;
      }
      if (input.budgetId) {
        headers['x-budget-id'] = input.budgetId;
      }

      // Build request body (exclude caller context fields)
      const body = {
        brandName: input.brandName,
        brandDescription: input.brandDescription,
        style: input.style,
        ...(input.brandTagline && { brandTagline: input.brandTagline }),
        ...(input.brandColors && { brandColors: input.brandColors }),
        ...(input.brandPersonality && { brandPersonality: input.brandPersonality }),
        ...(input.brandAudience && { brandAudience: input.brandAudience }),
        ...(input.styleDescription && { styleDescription: input.styleDescription }),
        ...(input.symbol && { symbol: input.symbol }),
        ...(input.count && { count: input.count }),
        ...(input.refinementLogoUrl && { refinementLogoUrl: input.refinementLogoUrl }),
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('logo.generate.api_error', {
          status: response.status,
          error: errorText.slice(0, 500),
          customerId: input.customerId,
        });
        return null;
      }

      const result = (await response.json()) as LogoGenerateResult;

      logger.info('logo.generate.success', {
        sessionId: result.sessionId,
        entitled: result.entitled,
        logoCount: result.logos.length,
        customerId: input.customerId,
      });

      return result;
    } catch (error) {
      logger.error('logo.generate.error', {
        error: error instanceof Error ? error.message : String(error),
        customerId: input.customerId,
      });
      return null;
    }
  }
}

export const logoService = new LogoService();
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "LogoService"`
Expected: PASS

**Step 5: Commit**

```bash
git add agents/src/services/LogoService.ts agents/src/services/__tests__/LogoService.test.ts
git commit -m "feat: add LogoService for server-side logo API calls with S2S auth"
```

---

### Task 4: Add Logo API Environment Config

**Context:** Add the `LOGO_API_URL` environment variable to the agents config, following the existing pattern for `GETTY_API_URL`.

**Files:**
- Modify: `agents/.env.example`

**Step 1: Add LOGO_API_URL to .env.example**

Find the Getty config section and add logo config nearby:

```bash
# Logo Generation API
LOGO_API_URL=https://logo-agent.mvci.api.dev-godaddy.com
```

**Step 2: Commit**

```bash
git add agents/.env.example
git commit -m "chore: add LOGO_API_URL to env example"
```

---

### Task 5: Update Media Skill Tool — Replace MCP with Direct REST Call

**Context:** The `generateLogoTool` in `agents/src/skills/media/tools/index.ts` currently uses `callMcpTool()` to proxy through the browser. Replace it with a direct call to `LogoService`. The tool needs to:
1. Get `customerId` from the app database
2. Get budget info from `GrantSessionManager`
3. Read brand data from memory (`app.title`, `app.description`) and app plan (colors)
4. Call `logoService.generateLogos()` directly

**Files:**
- Modify: `agents/src/skills/media/tools/index.ts`
- Test: `agents/src/skills/media/tools/__tests__/generate-logo.test.ts`

**Step 1: Write failing test for the updated logo tool**

```typescript
// agents/src/skills/media/tools/__tests__/generate-logo.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../services/LogoService', () => ({
  logoService: {
    generateLogos: vi.fn().mockResolvedValue({
      sessionId: 'sess-123',
      entitled: true,
      logos: [
        { id: 'logo-1', transparentUrl: 'https://cdn/t.png', solidUrl: 'https://cdn/s.png', mockupUrl: 'https://cdn/m.png' },
      ],
    }),
  },
}));

vi.mock('../../../../database/repositories/AppRepository', () => ({
  appRepository: {
    findById: vi.fn().mockResolvedValue({ customerId: 'cust-abc', subscriptionId: 'sub-xyz' }),
  },
}));

vi.mock('@airo/ai-grants', () => ({
  grantSessionManager: {
    getCurrentUserId: vi.fn().mockReturnValue('budget-user-111'),
    getSubscriptionState: vi.fn().mockReturnValue({
      grants: [{ llmBudgetId: 'budget-222' }],
      currentIndex: 0,
    }),
    getSubscriptionIdForSession: vi.fn().mockReturnValue('sub-xyz'),
  },
}));

describe('generateLogoTool', () => {
  it('should call logoService with brand inputs and context headers', async () => {
    const { logoService } = await import('../../../../services/LogoService');
    const tools = await import('../index');

    const generateLogoTool = tools.mediaSkillTools.find((t) => t.name === 'generate_logo');

    const context = {
      socketId: 'socket-1',
      metadata: { appId: 'app-123' },
    };

    const result = await generateLogoTool!.execute(
      {
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
      },
      context
    );

    expect(logoService.generateLogos).toHaveBeenCalledWith(
      expect.objectContaining({
        brandName: 'My Brand',
        brandDescription: 'A cool brand',
        style: 'flat',
        customerId: 'cust-abc',
        budgetUserId: 'budget-user-111',
        budgetId: 'budget-222',
      })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "generate-logo"`
Expected: FAIL — tool still uses callMcpTool

**Step 3: Update the tool input schema for v2 API**

In `agents/src/skills/media/tools/index.ts`, replace the `GenerateLogoInputSchema` with the v2 schema:

```typescript
const GenerateLogoInputSchema = z.object({
  brandName: z.string().min(1).max(100).describe('Primary text for the logo (business/brand name)'),
  brandTagline: z.string().max(100).optional().describe('Secondary text like tagline or slogan'),
  brandDescription: z.string().min(1).max(500).describe('What the business does - informs visual choices'),
  style: z.enum([
    'line', 'glyph', 'full-color', 'dual-tone', '3d',
    'badge', 'flat', 'colored-line', 'handmade',
    'mascot', 'monogram', 'name-mark',
  ]).describe('Logo visual style preset'),
  styleDescription: z.string().max(200).optional().describe('Additional custom style direction'),
  symbol: z.string().max(100).optional().describe('Icon or imagery to incorporate'),
  brandColors: z.string().max(100).optional().describe('Color preferences as a description'),
  brandPersonality: z.string().max(200).optional().describe('Brand personality traits'),
  brandAudience: z.string().max(200).optional().describe('Target audience description'),
  count: z.number().min(1).max(4).default(4).optional().describe('Number of logo variations'),
  refinementLogoUrl: z.string().url().max(500).optional().describe('URL of logo to refine'),
});
```

**Step 4: Rewrite the generateLogoTool execute function**

Replace the MCP-proxied implementation with direct LogoService call:

```typescript
import { logoService } from '../../../services/LogoService';
import { appRepository } from '../../../database/repositories/AppRepository';
import { grantSessionManager } from '@airo/ai-grants';

// In the generateLogoTool definition:
execute: async (input, context) => {
  const appId = (context as any)?.metadata?.appId;
  const socketId = (context as any)?.socketId;

  // 1. Get customer context from app database
  const app = appId ? await appRepository.findById(appId) : null;
  const customerId = app?.customerId;

  if (!customerId) {
    logger.error('logo.generate.no_customer', { appId });
    return { error: 'Unable to determine customer identity for logo generation' };
  }

  // 2. Get budget info from grant system
  let budgetUserId: string | undefined;
  let budgetId: string | undefined;

  if (socketId) {
    budgetUserId = grantSessionManager.getCurrentUserId(socketId, customerId) ?? undefined;
    const subscriptionId = grantSessionManager.getSubscriptionIdForSession(socketId);
    if (subscriptionId) {
      const state = grantSessionManager.getSubscriptionState(subscriptionId);
      if (state && state.grants[state.currentIndex]) {
        budgetId = state.grants[state.currentIndex].llmBudgetId;
      }
    }
  }

  // 3. Call logo API
  const result = await logoService.generateLogos({
    ...input,
    customerId,
    budgetUserId,
    budgetId,
  });

  if (!result) {
    return { error: 'Logo generation failed. Please try again.' };
  }

  // 4. Return structured result for the frontend
  return {
    structuredContent: {
      entitled: result.entitled,
      logos: result.logos,
      sessionId: result.sessionId,
    },
  };
},
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "generate-logo"`
Expected: PASS

**Step 6: Commit**

```bash
git add agents/src/skills/media/tools/index.ts agents/src/skills/media/tools/__tests__/generate-logo.test.ts
git commit -m "feat: replace MCP proxy with direct LogoService call for logo generation"
```

---

### Task 6: Add Brand Data Enrichment from Memory and App Plan

**Context:** The logo tool should auto-populate `brandName`, `brandDescription`, and `brandColors` from the agent's memory/app-plan if the caller (LLM) didn't provide them. This avoids asking the user for info they've already supplied. The LLM already has this context injected every turn, so it can fill in the tool params itself — but as a safety net, the tool implementation should also look up missing fields.

**Note:** This is a soft enrichment — only fills in fields the LLM didn't already provide. The LLM's prompt (skill.md) should instruct it to pull from known context first.

**Files:**
- Modify: `agents/src/skills/media/tools/index.ts` (enrich before API call)
- Modify: `agents/src/skills/media/skill.md` (instruct LLM to use known brand data)
- Test: `agents/src/skills/media/tools/__tests__/generate-logo.test.ts` (add enrichment test)

**Step 1: Write failing test for brand data enrichment**

Add to the existing test file:

```typescript
it('should enrich brandName from memory when not provided', async () => {
  const { logoService } = await import('../../../../services/LogoService');

  // Mock memory service to return app.title
  vi.mock('../../../../services/memory-service', () => ({
    memoryService: {
      get: vi.fn().mockImplementation((appId: string, key: string) => {
        if (key === 'app.title') return Promise.resolve({ value: 'Stored Brand Name' });
        if (key === 'app.description') return Promise.resolve({ value: 'Stored description' });
        return Promise.resolve(null);
      }),
    },
  }));

  const tools = await import('../index');
  const generateLogoTool = tools.mediaSkillTools.find((t) => t.name === 'generate_logo');

  const context = { socketId: 'socket-1', metadata: { appId: 'app-123' } };

  // Call without brandName — should be enriched from memory
  await generateLogoTool!.execute(
    { brandDescription: 'Test', style: 'flat' },
    context
  );

  expect(logoService.generateLogos).toHaveBeenCalledWith(
    expect.objectContaining({
      brandName: 'Stored Brand Name',
    })
  );
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "generate-logo"`
Expected: FAIL — no enrichment logic yet

**Step 3: Add enrichment logic to the tool execute function**

Before the `logoService.generateLogos()` call, add:

```typescript
import { memoryService } from '../../../services/memory-service';
import { appPlanTool } from '../../../tools/app-plan-tool';

// In execute, after getting customerId but before calling logoService:

// Enrich missing brand fields from memory/app plan
const enrichedInput = { ...input };

if (!enrichedInput.brandName && appId) {
  const titleEntry = await memoryService.get(appId, 'app.title');
  if (titleEntry?.value) {
    enrichedInput.brandName = String(titleEntry.value);
  }
}

if (!enrichedInput.brandDescription && appId) {
  const descEntry = await memoryService.get(appId, 'app.description');
  if (descEntry?.value) {
    enrichedInput.brandDescription = String(descEntry.value);
  }
}

if (!enrichedInput.brandColors && appId) {
  const plan = await appPlanTool.read(appId);
  if (plan?.colorPalette?.primary) {
    const palette = plan.colorPalette;
    enrichedInput.brandColors = `primary: ${palette.primary}, secondary: ${palette.secondary || ''}, accent: ${palette.accent || ''}`.trim();
  }
}
```

**Step 4: Update skill.md to instruct LLM to use known brand data**

In `agents/src/skills/media/skill.md`, add to the logo generation best practices section:

```markdown
### Brand Data from Context

Before calling `media__generate_logo`, check the conversation context for existing brand information:

- **Brand name**: Use `app.title` from memory context if available
- **Description**: Use `app.description` from memory context if available
- **Colors**: Use the color palette from the app plan context if available

Only ask the user for information that isn't already available in the context. The tool will also auto-enrich missing fields from stored data as a fallback.
```

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "generate-logo"`
Expected: PASS

**Step 6: Commit**

```bash
git add agents/src/skills/media/tools/index.ts agents/src/skills/media/skill.md agents/src/skills/media/tools/__tests__/generate-logo.test.ts
git commit -m "feat: auto-enrich logo inputs from memory and app plan"
```

---

### Task 7: Verify S2S Auth Import Path and ai-lib Integration

**Context:** The `LogoService` imports `getS2SToken` from `@airo/ai-lib/utils/s2s-auth`. We need to verify this import works from the agents package and that the S2S auth system is properly enabled. The function already exists in ai-lib but may need the `GOCODE_USE_S2S_AUTH=true` env var.

**Files:**
- Modify: `agents/.env.example` (add S2S auth enablement if needed)
- Check: `packages/ai-lib/src/utils/s2s-auth.ts` (verify export path)
- Check: `packages/ai-lib/package.json` (verify export mapping)

**Step 1: Verify the import path resolves**

Run: `pnpm --filter @airo/agents exec node -e "require('@airo/ai-lib/utils/s2s-auth')" 2>&1 | head -5`

If this fails, check `packages/ai-lib/package.json` for the `exports` field and adjust the import in `LogoService.ts` accordingly. The correct import path may be:
- `@airo/ai-lib/utils/s2s-auth` (if exports configured)
- `@airo/ai-lib/src/utils/s2s-auth` (direct path)
- Or imported via the main barrel: `import { getS2SToken } from '@airo/ai-lib'`

**Step 2: Add required env vars**

In `agents/.env.example`, add:

```bash
# S2S Auth (for server-to-server API calls like logo generation)
# Set to true to enable AWS IAM based S2S authentication
GOCODE_USE_S2S_AUTH=true
```

**Step 3: Verify LogoService test still passes with correct import**

Run: `pnpm --filter @airo/agents test:unit "LogoService"`
Expected: PASS

**Step 4: Commit**

```bash
git add agents/.env.example
git commit -m "chore: configure S2S auth for logo API calls"
```

---

### Task 8: Update Skill Documentation for v2 REST API

**Context:** Update the skill.md file to reflect the new v2 input schema (field names changed from `name`/`description`/`colors` to `brandName`/`brandDescription`/`brandColors`) and document the new behavior.

**Files:**
- Modify: `agents/src/skills/media/skill.md`

**Step 1: Update the logo generation parameter table and examples**

Replace the existing logo generation section with v2 field names:

| Parameter           | Type         | Required | Description                                         |
| ------------------- | ------------ | -------- | --------------------------------------------------- |
| `brandName`         | string       | Yes      | Primary text for the logo (business/brand name)     |
| `brandTagline`      | string       | No       | Secondary text like tagline or slogan               |
| `brandDescription`  | string       | Yes      | What the business does — informs visual choices     |
| `style`             | enum         | Yes      | Logo style preset (see options below)               |
| `styleDescription`  | string       | No       | Additional custom style direction                   |
| `symbol`            | string       | No       | Icon or imagery to incorporate                      |
| `brandColors`       | string       | No       | Color preferences as description                    |
| `brandPersonality`  | string       | No       | Brand personality traits                            |
| `brandAudience`     | string       | No       | Target audience description                         |
| `count`             | number (1-4) | No       | Number of logo variations (default: 4)              |
| `refinementLogoUrl` | string (URL) | No       | URL of a logo to refine from previous generation    |

Update the example call:

```typescript
media__generate_logo({
  brandName: 'Sunrise Cafe',
  brandDescription: 'A cozy neighborhood coffee shop serving artisan coffee and fresh pastries',
  style: 'handmade',
  styleDescription: 'warm and welcoming',
  brandColors: 'warm earth tones with orange accents',
  symbol: 'coffee cup with sunrise',
});
```

**Step 2: Update the output format documentation**

The output format should match the v2 REST API response (not MCP):

```typescript
{
  structuredContent: {
    sessionId: string,
    entitled: boolean,
    logos: [
      {
        id: string,
        transparentUrl: string,  // PNG with transparent background
        solidUrl: string,        // PNG with solid background
        mockupUrl: string        // Mockup showing logo in context
      }
    ]
  }
}
```

**Step 3: Commit**

```bash
git add agents/src/skills/media/skill.md
git commit -m "docs: update media skill docs for v2 REST API with new field names"
```

---

### Task 9: Clean Up — Remove MCP Logo References

**Context:** The logo tool no longer uses the MCP proxy path. Clean up any logo-specific MCP references while keeping the MCP infrastructure intact for image generation and video generation (which still use imagegen-agent MCP).

**Files:**
- Modify: `agents/src/skills/media/tools/index.ts` (remove logo-specific MCP code)

**Step 1: Remove logoAgent from getMcpServerUrls**

The `getMcpServerUrls` function returns both `logoAgent` and `imagegenAgent`. Since only image/video still use MCP, remove the `logoAgent` URL:

```typescript
function getMcpServerUrls() {
  const envPrefix = getMcpEnvironmentPrefix();
  return {
    imagegenAgent: `https://imagegen-agent.mvci.api.${envPrefix}godaddy.com/mcp`,
  };
}
```

**Step 2: Remove old GenerateLogoInputSchema if still present**

If the old schema with `name`/`description`/`colors` fields is still in the file alongside the new one, remove the old version.

**Step 3: Verify image/video tools still work**

Run: `pnpm --filter @airo/agents test:unit "media"` (if tests exist for other media tools)
Expected: PASS — image and video tools unchanged

**Step 4: Run full typecheck**

Run: `pnpm typecheck`
Expected: No errors related to media skill

**Step 5: Commit**

```bash
git add agents/src/skills/media/tools/index.ts
git commit -m "refactor: remove logo-agent MCP URL, logo now uses REST API"
```

---

### Task 10: Integration Verification

**Context:** Verify the full stack compiles and passes lint/typecheck.

**Files:**
- Review all modified files

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

**Step 3: Run agents unit tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

**Step 4: Run build**

Run: `pnpm build`
Expected: PASS

**Step 5: Manual integration test checklist**

- [ ] Set `LOGO_API_URL` and `GOCODE_USE_S2S_AUTH=true` in agents `.env`
- [ ] Start agents server
- [ ] Trigger logo generation via chat ("Generate a logo for my business")
- [ ] Verify: No WebSocket/browser proxy used (check network tab — no `client_action` messages for logo)
- [ ] Verify: Logo API called directly from agents server (check agents server logs for `logo.generate.begin`)
- [ ] Verify: Logos display correctly in frontend (existing LogoGridWidget/LogoGeneratorToolRenderer)
- [ ] Verify: Budget headers appear in logo API request logs
- [ ] Verify: Brand data auto-enriched from memory when available

**Step 6: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address integration issues from verification"
```

---

## Summary of Changes

### gai-logo-agent (Track A)

| File | Change |
|------|--------|
| `packages/api/src/middleware/auth.ts` | Accept `awsiam` auth type + `x-customer-id` header |
| `packages/api/src/index.ts` | Configure auth middleware for `['idp', 'awsiam']` |
| `packages/api/src/handlers/generateLogo.ts` | Extract budget headers, pass to generation |
| `packages/api/src/logo-v2/types.ts` | Add `budgetUserId`, `budgetId` to config |
| `packages/api/src/logo-v2/imageGeneration.ts` | Pass litellm metadata headers to GoCode client |
| `packages/api/src/logo-v2/index.ts` | Thread budget config through to image generation |

### airo-app-builder (Track B)

| File | Change |
|------|--------|
| `agents/src/services/LogoService.ts` | **New** — REST client for logo API with S2S auth |
| `agents/src/skills/media/tools/index.ts` | Replace MCP proxy with direct LogoService call, v2 input schema, brand enrichment |
| `agents/src/skills/media/skill.md` | Updated docs for v2 field names and brand context guidance |
| `agents/.env.example` | Add `LOGO_API_URL`, `GOCODE_USE_S2S_AUTH` |

### Architecture Before vs After

```
BEFORE:
  Agent → callMcpTool() → ClientActionService → WebSocket → Browser
    → fetch(MCP SSE) with auth_idp cookie → Logo MCP Server → GoCode

AFTER:
  Agent → LogoService → fetch(REST POST) with S2S token
    → x-customer-id, x-budget-user-id headers → Logo REST API → GoCode
```

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth mechanism | AWS IAM S2S via `getS2SToken()` | Already in ai-lib, no static secrets, auto-rotated |
| Customer identity | `x-customer-id` header | Clean separation, logo API validates entitlements |
| Budget tracking | Pass `llmBudgetUserId`/`llmBudgetId` as headers → litellm metadata | Reuses existing grant system, bills to same budget |
| Brand enrichment | Memory + app plan fallback in tool | LLM fills from context first, tool catches gaps |
| MCP removal | Logo only, keep MCP for image/video | Minimal blast radius, other tools unchanged |
