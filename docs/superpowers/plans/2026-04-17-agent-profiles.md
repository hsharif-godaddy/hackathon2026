# Agent Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a named JSON profile system that overrides agent behavior (models, prompts, feature flags) per-customer via Switchboard + JWT claims.

**Architecture:** Code-defined JSON profiles loaded at startup into an in-memory registry. Active profile set via AsyncLocalStorage in WebSocket messageMiddleware (same pattern as model override). Typed accessor helpers (`profileValue`, `profileFlag`) let any agent code read profile properties with defaults. Enablement via two Switchboard flags embedded in JWT claims.

**Tech Stack:** TypeScript, Zod, AsyncLocalStorage, Express, React (Next.js), Zustand, React Query, Vitest

---

### Task 1: Profile Types & Schema

**Files:**

- Create: `agents/src/profiles/types.ts`
- Test: `agents/src/profiles/__tests__/profile-types.test.ts`

- [ ] **Step 1: Write the failing test for schema validation**

Create `agents/src/profiles/__tests__/profile-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { ProfileSchema, type ProfileData } from "../types.js";

describe("ProfileSchema", function profileSchemaTests() {
  it("validates a valid profile", function validProfile() {
    const valid = {
      name: "experimental",
      description: "Test profile",
      properties: {
        "model.default": "claude-opus-4-6",
        "feature.commerce.enabled": true,
        "context.maxHistoryMessages": 50,
        "feature.disabled": null,
      },
    };
    const result = ProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("experimental");
      expect(result.data.properties["model.default"]).toBe("claude-opus-4-6");
    }
  });

  it("rejects profile with empty name", function emptyName() {
    const invalid = { name: "", description: "Test", properties: {} };
    const result = ProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects profile with nested object property", function nestedObject() {
    const invalid = {
      name: "bad",
      description: "Test",
      properties: { nested: { deep: true } },
    };
    const result = ProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects profile with array property", function arrayProp() {
    const invalid = {
      name: "bad",
      description: "Test",
      properties: { list: [1, 2, 3] },
    };
    const result = ProfileSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("allows empty properties", function emptyProps() {
    const valid = {
      name: "minimal",
      description: "Minimal profile",
      properties: {},
    };
    const result = ProfileSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "profile-types"`
Expected: FAIL — cannot find `../types.js`

- [ ] **Step 3: Write the implementation**

Create `agents/src/profiles/types.ts`:

```typescript
import { z } from "zod";

export const ProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});

export type ProfileData = z.infer<typeof ProfileSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "profile-types"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/profiles/types.ts agents/src/profiles/__tests__/profile-types.test.ts
git commit -m "feat(profiles): add profile types and Zod schema"
```

---

### Task 2: AsyncLocalStorage Profile Context

**Files:**

- Create: `agents/src/profiles/profile-context.ts`
- Test: `agents/src/profiles/__tests__/profile-context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/profiles/__tests__/profile-context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import type { ProfileData } from "../types.js";
import { getActiveProfile, runWithProfile } from "../profile-context.js";

const testProfile: ProfileData = {
  name: "test-profile",
  description: "Test",
  properties: {
    "model.default": "claude-opus-4-6",
    "feature.test": true,
  },
};

describe("profile-context", function profileContextTests() {
  it("returns null when no profile is active", function noProfile() {
    expect(getActiveProfile()).toBeNull();
  });

  it("returns the active profile inside runWithProfile", function activeProfile() {
    runWithProfile(testProfile, () => {
      const active = getActiveProfile();
      expect(active).not.toBeNull();
      expect(active!.name).toBe("test-profile");
      expect(active!.properties["model.default"]).toBe("claude-opus-4-6");
    });
  });

  it("returns null after runWithProfile completes", function afterRun() {
    runWithProfile(testProfile, () => {});
    expect(getActiveProfile()).toBeNull();
  });

  it("supports nested runWithProfile (inner overrides outer)", function nested() {
    const innerProfile: ProfileData = {
      name: "inner",
      description: "Inner",
      properties: { "model.default": "claude-haiku-4-5" },
    };
    runWithProfile(testProfile, () => {
      expect(getActiveProfile()!.name).toBe("test-profile");
      runWithProfile(innerProfile, () => {
        expect(getActiveProfile()!.name).toBe("inner");
      });
      expect(getActiveProfile()!.name).toBe("test-profile");
    });
  });

  it("propagates through async calls", async function asyncPropagation() {
    await runWithProfile(testProfile, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(getActiveProfile()!.name).toBe("test-profile");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "profile-context"`
Expected: FAIL — cannot find `../profile-context.js`

- [ ] **Step 3: Write the implementation**

Create `agents/src/profiles/profile-context.ts`:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

import type { ProfileData } from "./types.js";

const storage = new AsyncLocalStorage<ProfileData>();

export function runWithProfile<T>(profile: ProfileData, fn: () => T): T {
  return storage.run(profile, fn);
}

export function getActiveProfile(): ProfileData | null {
  return storage.getStore() ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "profile-context"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/profiles/profile-context.ts agents/src/profiles/__tests__/profile-context.test.ts
git commit -m "feat(profiles): add AsyncLocalStorage profile context"
```

---

### Task 3: Profile Accessor API

**Files:**

- Create: `agents/src/profiles/profile-accessor.ts`
- Test: `agents/src/profiles/__tests__/profile-accessor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/profiles/__tests__/profile-accessor.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { runWithProfile } from "../profile-context.js";
import {
  activeProfileName,
  hasActiveProfile,
  profileFlag,
  profileValue,
} from "../profile-accessor.js";
import type { ProfileData } from "../types.js";

const testProfile: ProfileData = {
  name: "test-profile",
  description: "Test",
  properties: {
    "model.default": "claude-opus-4-6",
    "feature.enabled": true,
    "feature.disabled": false,
    "context.maxHistory": 50,
    "nullable.key": null,
  },
};

describe("profile-accessor", function profileAccessorTests() {
  describe("profileValue", function profileValueTests() {
    it("returns default when no profile is active", function noProfile() {
      expect(profileValue("model.default", "claude-sonnet-4-6")).toBe(
        "claude-sonnet-4-6",
      );
    });

    it("returns profile value when profile is active", function withProfile() {
      runWithProfile(testProfile, () => {
        expect(profileValue("model.default", "claude-sonnet-4-6")).toBe(
          "claude-opus-4-6",
        );
      });
    });

    it("returns default when key is not in profile", function missingKey() {
      runWithProfile(testProfile, () => {
        expect(profileValue("nonexistent.key", "fallback")).toBe("fallback");
      });
    });

    it("returns number values", function numberValue() {
      runWithProfile(testProfile, () => {
        expect(profileValue("context.maxHistory", 10)).toBe(50);
      });
    });

    it("returns default when profile value is null", function nullValue() {
      runWithProfile(testProfile, () => {
        expect(profileValue("nullable.key", "default")).toBe("default");
      });
    });
  });

  describe("profileFlag", function profileFlagTests() {
    it("returns false by default when no profile is active", function noProfileDefault() {
      expect(profileFlag("feature.enabled")).toBe(false);
    });

    it("returns custom default when no profile is active", function customDefault() {
      expect(profileFlag("feature.enabled", true)).toBe(true);
    });

    it("returns true when flag is true in profile", function trueFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag("feature.enabled")).toBe(true);
      });
    });

    it("returns false when flag is false in profile", function falseFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag("feature.disabled", true)).toBe(false);
      });
    });

    it("returns default when flag key is missing from profile", function missingFlag() {
      runWithProfile(testProfile, () => {
        expect(profileFlag("feature.nonexistent", true)).toBe(true);
      });
    });
  });

  describe("hasActiveProfile", function hasActiveProfileTests() {
    it("returns false when no profile is active", function inactive() {
      expect(hasActiveProfile()).toBe(false);
    });

    it("returns true when profile is active", function active() {
      runWithProfile(testProfile, () => {
        expect(hasActiveProfile()).toBe(true);
      });
    });
  });

  describe("activeProfileName", function activeProfileNameTests() {
    it("returns null when no profile is active", function inactive() {
      expect(activeProfileName()).toBeNull();
    });

    it("returns the profile name when active", function active() {
      runWithProfile(testProfile, () => {
        expect(activeProfileName()).toBe("test-profile");
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "profile-accessor"`
Expected: FAIL — cannot find `../profile-accessor.js`

- [ ] **Step 3: Write the implementation**

Create `agents/src/profiles/profile-accessor.ts`:

```typescript
import { getActiveProfile } from "./profile-context.js";

export function profileValue<T extends string | number | boolean>(
  key: string,
  defaultValue: T,
): T {
  const profile = getActiveProfile();
  if (!profile) return defaultValue;

  const value = profile.properties[key];
  if (value === undefined || value === null) return defaultValue;

  return value as T;
}

export function profileFlag(
  key: string,
  defaultValue: boolean = false,
): boolean {
  return profileValue(key, defaultValue);
}

export function hasActiveProfile(): boolean {
  return getActiveProfile() !== null;
}

export function activeProfileName(): string | null {
  return getActiveProfile()?.name ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "profile-accessor"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/profiles/profile-accessor.ts agents/src/profiles/__tests__/profile-accessor.test.ts
git commit -m "feat(profiles): add typed profile accessor API"
```

---

### Task 4: Profile Registry & Resolution

**Files:**

- Create: `agents/src/profiles/index.ts`
- Create: `agents/src/profiles/experimental.json`
- Test: `agents/src/profiles/__tests__/profile-resolution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/profiles/__tests__/profile-resolution.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ProfileData } from "../types.js";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock("../../../logging/index.js", () => ({
  logger: mockLogger,
}));

import { getProfileRegistry, resolveProfile } from "../index.js";

describe("profile-registry", function registryTests() {
  beforeEach(function resetMocks() {
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.debug.mockReset();
  });

  describe("getProfileRegistry", function getRegistryTests() {
    it("loads the experimental profile", function loadsExperimental() {
      const registry = getProfileRegistry();
      expect(registry.has("experimental")).toBe(true);
      const profile = registry.get("experimental")!;
      expect(profile.name).toBe("experimental");
      expect(profile.description).toBeTruthy();
    });
  });

  describe("resolveProfile", function resolveTests() {
    it("returns null when no override specified", function noOverride() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: undefined,
        jwtAgentProfile: undefined,
      });
      expect(result).toBeNull();
    });

    it("returns profile from JWT claim", function jwtProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: "experimental",
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe("experimental");
    });

    it("per-project overrides JWT when selector enabled", function perProjectPriority() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: "experimental",
        jwtAgentProfile: undefined,
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe("experimental");
    });

    it("ignores per-project when selector disabled", function selectorDisabled() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: "experimental",
        jwtAgentProfile: undefined,
      });
      expect(result).toBeNull();
    });

    it("returns null and logs warning for unknown profile", function unknownProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: true,
        perProjectProfile: "nonexistent",
        jwtAgentProfile: undefined,
      });
      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "profile.resolve.unknown",
        expect.objectContaining({ profileName: "nonexistent" }),
      );
    });

    it('returns null for "default" profile name from JWT', function defaultProfile() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: "default",
      });
      expect(result).toBeNull();
    });

    it("returns null for empty string profile name", function emptyString() {
      const result = resolveProfile({
        agentProfileSelectorEnabled: false,
        perProjectProfile: undefined,
        jwtAgentProfile: "",
      });
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "profile-resolution"`
Expected: FAIL — cannot find `../index.js`

- [ ] **Step 3: Create the example profile**

Create `agents/src/profiles/experimental.json`:

```json
{
  "name": "experimental",
  "description": "Experimental agent configuration for A/B testing",
  "properties": {
    "model.default": "claude-opus-4-6",
    "model.fast": "claude-haiku-4-5",
    "feature.commerce.enabled": true,
    "feature.assessment.enabled": false,
    "context.maxHistoryMessages": 50
  }
}
```

- [ ] **Step 4: Write the registry implementation**

Create `agents/src/profiles/index.ts`:

```typescript
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "../logging/index.js";
import type { ProfileData } from "./types.js";
import { ProfileSchema } from "./types.js";

export { type ProfileData } from "./types.js";
export { runWithProfile, getActiveProfile } from "./profile-context.js";
export {
  profileValue,
  profileFlag,
  hasActiveProfile,
  activeProfileName,
} from "./profile-accessor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let registry: Map<string, ProfileData> | null = null;

function loadProfiles(): Map<string, ProfileData> {
  const profiles = new Map<string, ProfileData>();
  const profileDir = __dirname;

  let files: string[];
  try {
    files = readdirSync(profileDir).filter((f) => f.endsWith(".json"));
  } catch {
    logger.warn("profile.load.directory_error", { profileDir });
    return profiles;
  }

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(profileDir, file), "utf-8"));
      const result = ProfileSchema.safeParse(raw);
      if (!result.success) {
        logger.warn("profile.load.invalid", {
          file,
          errors: result.error.issues.map((i) => i.message),
        });
        continue;
      }

      const profile = result.data;
      if (profiles.has(profile.name)) {
        logger.error("profile.load.duplicate", {
          profileName: profile.name,
          file,
          message: "Duplicate profile name, skipping",
        });
        continue;
      }

      profiles.set(profile.name, profile);
      logger.info("profile.load.success", {
        profileName: profile.name,
        file,
        propertyCount: Object.keys(profile.properties).length,
      });
    } catch (error) {
      logger.warn("profile.load.invalid", {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return profiles;
}

export function getProfileRegistry(): Map<string, ProfileData> {
  if (!registry) {
    registry = loadProfiles();
  }
  return registry;
}

export function resolveProfile(params: {
  agentProfileSelectorEnabled: boolean;
  perProjectProfile?: string;
  jwtAgentProfile?: string;
}): ProfileData | null {
  const perProject = params.agentProfileSelectorEnabled
    ? params.perProjectProfile
    : undefined;
  const profileName = perProject || params.jwtAgentProfile || undefined;

  if (!profileName || profileName === "default") {
    logger.debug("profile.resolve.none", {
      reason: profileName ? "default" : "no profile specified",
    });
    return null;
  }

  const reg = getProfileRegistry();
  const profile = reg.get(profileName);
  if (!profile) {
    logger.warn("profile.resolve.unknown", { profileName });
    return null;
  }

  return profile;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "profile-resolution"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add agents/src/profiles/index.ts agents/src/profiles/experimental.json agents/src/profiles/__tests__/profile-resolution.test.ts
git commit -m "feat(profiles): add profile registry and resolution logic"
```

---

### Task 5: Agent Context & JWT Claims (Agents Side)

**Files:**

- Modify: `agents/src/server/middleware/jwt-auth.ts:25-73`

- [ ] **Step 1: Write the failing test**

The existing test file is at `agents/src/server/middleware/__tests__/jwt-auth.test.ts`. Add new test cases. First, check if that file exists and find the `buildAgentContext` test section:

Run: `pnpm --filter @airo/agents test:unit "jwt-auth" -t "buildAgentContext"` to see the current state.

Add to the existing test file (or create a new test block if no `buildAgentContext` tests exist):

```typescript
// Add these test cases to the existing jwt-auth test file

it("extracts agentProfile from raw claims", function extractsAgentProfile() {
  const raw = {
    siteId: "test-site",
    canDownload: true,
    canPublish: true,
    agentProfile: "experimental",
    agentProfileSelectorEnabled: true,
    exp: 9999999999,
    iat: 1000000000,
  };
  const context = buildAgentContext(raw);
  expect(context.agentProfile).toBe("experimental");
  expect(context.agentProfileSelectorEnabled).toBe(true);
});

it("defaults agentProfileSelectorEnabled to false when missing", function defaultsFalse() {
  const raw = {
    siteId: "test-site",
    canDownload: true,
    canPublish: true,
    exp: 9999999999,
    iat: 1000000000,
  };
  const context = buildAgentContext(raw);
  expect(context.agentProfile).toBeUndefined();
  expect(context.agentProfileSelectorEnabled).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "jwt-auth"`
Expected: FAIL — `agentProfile` not a property of `AgentContext`

- [ ] **Step 3: Update AgentContext interface and buildAgentContext**

In `agents/src/server/middleware/jwt-auth.ts`, add to the `AgentContext` interface (after line 40, `modelSelectorEnabled`):

```typescript
agentProfile?: string;
agentProfileSelectorEnabled?: boolean;
```

In `buildAgentContext()`, add after the `modelSelectorEnabled` extraction (after line 69):

```typescript
agentProfile: raw.agentProfile as string | undefined,
agentProfileSelectorEnabled: (raw.agentProfileSelectorEnabled as boolean) ?? false,
```

Also update the `AuthType.NONE` and `AuthType.MOCK` blocks to include `agentProfileSelectorEnabled: true` (same as `modelSelectorEnabled: true` on lines 147 and 164) so local dev has the selector enabled.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "jwt-auth"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add agents/src/server/middleware/jwt-auth.ts agents/src/server/middleware/__tests__/jwt-auth.test.ts
git commit -m "feat(profiles): add agentProfile claims to AgentContext"
```

---

### Task 6: Profiles Route (Agent Service)

**Files:**

- Create: `agents/src/server/routes/profiles.ts`
- Modify: `agents/src/server/routes/index.ts:29`
- Modify: `agents/src/server/app.ts:330`
- Test: `agents/src/server/routes/__tests__/profiles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/server/routes/__tests__/profiles.test.ts` following the pattern from `models.test.ts`:

```typescript
import type { IRouter, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedRequest } from "../../middleware/jwt-auth.js";

const mockGetProfileRegistry = vi.hoisted(function createMocks() {
  return vi.fn();
});

vi.mock("../../../profiles/index.js", function mockProfiles() {
  return {
    getProfileRegistry: mockGetProfileRegistry,
  };
});

import profilesRouter from "../profiles.js";

function getGetProfilesHandler(router: IRouter) {
  for (const layer of router.stack) {
    if (layer.route?.path === "/profiles" && layer.route.methods.get) {
      return layer.route.stack[0].handle as (
        req: AuthenticatedRequest,
        res: Response,
      ) => void;
    }
  }
  throw new Error("GET /profiles handler not found");
}

function createMockRes() {
  const state = { status: 200, body: undefined as unknown };
  return {
    status(code: number) {
      state.status = code;
      return this;
    },
    json(payload: unknown) {
      state.body = payload;
    },
    getStatus() {
      return state.status;
    },
    getBody() {
      return state.body;
    },
  };
}

describe("@airo/agents", function packageTests() {
  describe("#getProfiles", function getProfilesTests() {
    const handler = getGetProfilesHandler(profilesRouter);

    beforeEach(function resetMocks() {
      mockGetProfileRegistry.mockReset();
    });

    it("returns 403 when agentProfileSelectorEnabled is false", function returns403() {
      const req = {
        agentContext: { agentProfileSelectorEnabled: false },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      expect(res.getStatus()).toBe(403);
      expect(res.getBody()).toEqual({
        error: "Profile selection is not enabled",
      });
    });

    it("returns 403 when agentProfileSelectorEnabled is undefined", function returns403Undefined() {
      const req = { agentContext: {} } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      expect(res.getStatus()).toBe(403);
    });

    it("returns profiles list when enabled", function returnsProfiles() {
      const registry = new Map([
        [
          "experimental",
          {
            name: "experimental",
            description: "Test profile",
            properties: { "model.default": "claude-opus-4-6" },
          },
        ],
        [
          "conservative",
          {
            name: "conservative",
            description: "Safe defaults",
            properties: { "feature.new": false },
          },
        ],
      ]);
      mockGetProfileRegistry.mockReturnValue(registry);

      const req = {
        agentContext: { agentProfileSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as {
        profiles: Array<{
          name: string;
          description: string;
          properties: Record<string, unknown>;
        }>;
      };
      expect(body.profiles).toHaveLength(2);
      expect(body.profiles[0].name).toBe("experimental");
      expect(body.profiles[0].description).toBe("Test profile");
      expect(body.profiles[0].properties).toEqual({
        "model.default": "claude-opus-4-6",
      });
      expect(body.profiles[1].name).toBe("conservative");
    });

    it("returns empty list when no profiles loaded", function emptyRegistry() {
      mockGetProfileRegistry.mockReturnValue(new Map());

      const req = {
        agentContext: { agentProfileSelectorEnabled: true },
      } as AuthenticatedRequest;
      const res = createMockRes();

      handler(req, res as Response);

      const body = res.getBody() as { profiles: unknown[] };
      expect(body.profiles).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "routes/__tests__/profiles"`
Expected: FAIL — cannot find `../profiles.js`

- [ ] **Step 3: Write the route implementation**

Create `agents/src/server/routes/profiles.ts`:

```typescript
import { Router, type IRouter } from "express";

import { getProfileRegistry } from "../../profiles/index.js";
import type { AuthenticatedRequest } from "../middleware/jwt-auth.js";

const router: IRouter = Router();

router.get("/profiles", (req, res) => {
  const agentContext = (req as AuthenticatedRequest).agentContext;
  if (!agentContext?.agentProfileSelectorEnabled) {
    res.status(403).json({ error: "Profile selection is not enabled" });
    return;
  }

  const registry = getProfileRegistry();
  const profiles = [...registry.values()].map((p) => ({
    name: p.name,
    description: p.description,
    properties: p.properties,
  }));

  res.json({ profiles });
});

export default router;
```

- [ ] **Step 4: Register the route**

In `agents/src/server/routes/index.ts`, add after line 29 (`modelsRouter`):

```typescript
export { default as profilesRouter } from "./profiles.js";
```

In `agents/src/server/app.ts`, add after line 330 (`modelsRouter`):

```typescript
protectedRouter.use("/", profilesRouter);
```

Also add `profilesRouter` to the import on line 186. Find the import that includes `modelsRouter` and add `profilesRouter` next to it.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "routes/__tests__/profiles"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add agents/src/server/routes/profiles.ts agents/src/server/routes/__tests__/profiles.test.ts agents/src/server/routes/index.ts agents/src/server/app.ts
git commit -m "feat(profiles): add GET /profiles route"
```

---

### Task 7: WebSocket MessageMiddleware Integration

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts:2110-2145`

- [ ] **Step 1: Add the profile imports**

At the top of `agents/src/server/ai-lib-websocket-server.ts`, add to the imports (near the existing `model-override` imports):

```typescript
import { resolveProfile, runWithProfile } from "../profiles/index.js";
```

- [ ] **Step 2: Update the messageMiddleware**

Replace the `messageMiddleware` function body (lines ~2115-2145) with profile context wrapping. The profile context MUST wrap the model override context so `profileValue()` is readable from model selection code.

Current code (lines 2115-2145):

```typescript
messageMiddleware: async (
  socketId: string,
  context: Record<string, unknown> | undefined,
  execute: () => Promise<void>,
) => {
  const socket = getSocket(socketId);
  const agentContext = socket?.handshake?.auth?.agentContext;

  const effectiveOverride = resolveOverride({
    modelSelectorEnabled: !!agentContext?.modelSelectorEnabled,
    perProjectModel: (context as any)?.metadata?.modelOverride as
      | string
      | undefined,
    jwtModelOverride: agentContext?.modelOverride as string | undefined,
  });

  if (effectiveOverride) {
    const allowed = guardAllowedOverrideModel(
      effectiveOverride,
      "messageMiddleware",
      function logReject(event: string, data: Record<string, unknown>) {
        logger.warn(event, data);
      },
    );
    if (allowed) {
      logger.info("model.override.context.active", {
        effectiveOverride: allowed,
        socketId,
      });
      await runWithModelOverride(allowed, execute);
      return;
    }
  }

  await execute();
};
```

Replace with:

```typescript
messageMiddleware: async (
  socketId: string,
  context: Record<string, unknown> | undefined,
  execute: () => Promise<void>,
) => {
  const socket = getSocket(socketId);
  const agentContext = socket?.handshake?.auth?.agentContext;

  const profile = resolveProfile({
    agentProfileSelectorEnabled: !!agentContext?.agentProfileSelectorEnabled,
    perProjectProfile: (context as any)?.metadata?.agentProfile as
      | string
      | undefined,
    jwtAgentProfile: agentContext?.agentProfile as string | undefined,
  });

  if (profile) {
    logger.info("profile.resolve.active", {
      profileName: profile.name,
      socketId,
    });
  }

  const effectiveOverride = resolveOverride({
    modelSelectorEnabled: !!agentContext?.modelSelectorEnabled,
    perProjectModel: (context as any)?.metadata?.modelOverride as
      | string
      | undefined,
    jwtModelOverride: agentContext?.modelOverride as string | undefined,
  });

  const executeWithModelOverride = async () => {
    if (effectiveOverride) {
      const allowed = guardAllowedOverrideModel(
        effectiveOverride,
        "messageMiddleware",
        function logReject(event: string, data: Record<string, unknown>) {
          logger.warn(event, data);
        },
      );
      if (allowed) {
        logger.info("model.override.context.active", {
          effectiveOverride: allowed,
          socketId,
        });
        await runWithModelOverride(allowed, execute);
        return;
      }
    }
    await execute();
  };

  if (profile) {
    await runWithProfile(profile, executeWithModelOverride);
  } else {
    await executeWithModelOverride();
  }
};
```

- [ ] **Step 3: Run existing tests to verify nothing is broken**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat(profiles): integrate profile context into WebSocket messageMiddleware"
```

---

### Task 8: JWT Claims & BFF (App Side)

**Files:**

- Modify: `app/src/lib/jwt-config.ts:34-35`
- Modify: `app/src/lib/jwt-service.ts:16-32,157-196,246-249`
- Modify: `app/src/app/api/auth/agent-token/route.ts:228-300,322-338`
- Modify: `app/src/lib/switchboard/server.ts:17-38`
- Modify: `app/src/hooks/useSwitchboard.ts:21-44`

- [ ] **Step 1: Add JWT claims**

In `app/src/lib/jwt-config.ts`, add after line 35 (`modelSelectorEnabled`):

```typescript
agentProfile?: string; // When set, activate the named agent profile (switchboard: appbuilder-agent-profile)
agentProfileSelectorEnabled?: boolean; // When true, allow per-project profile selection from frontend (switchboard: appbuilder-agent-profile-selector)
```

- [ ] **Step 2: Add to CreateTokenOptions**

In `app/src/lib/jwt-service.ts`, add after line 31 (`modelSelectorEnabled`):

```typescript
agentProfile?: string; // Activate the named agent profile (switchboard: appbuilder-agent-profile)
agentProfileSelectorEnabled?: boolean; // Allow per-project profile selection from frontend (switchboard: appbuilder-agent-profile-selector)
```

- [ ] **Step 3: Add to createTokenPayload**

In `app/src/lib/jwt-service.ts`, in the `claims` object inside `createTokenPayload()` (after line 186, `modelSelectorEnabled`):

```typescript
...(options.agentProfile && { agentProfile: options.agentProfile }),
agentProfileSelectorEnabled: options.agentProfileSelectorEnabled ?? false,
```

- [ ] **Step 4: Update getCacheKey**

In `app/src/lib/jwt-service.ts`, update `getCacheKey()` (line 248). Append to the end of the return string:

```typescript
return `${options.siteId}:${options.customerId || ""}:${options.canDownload}:${options.canPublish}:${options.canPurchaseDomain ?? false}:${authType}:${options.useTestBudget ?? false}:${options.budgetServiceEnabled ?? false}:${options.subscriptionId || ""}:${options.enableAssessmentAgent ?? false}:${options.enableAssessmentOverride ?? false}:${options.product || "AiroAppBuilder"}:${options.modelOverride || ""}:${options.modelSelectorEnabled ?? false}:${options.agentProfile || ""}:${options.agentProfileSelectorEnabled ?? false}`;
```

- [ ] **Step 5: Add switchboard calls to agent-token route**

In `app/src/app/api/auth/agent-token/route.ts`:

Add variable declarations after line 229 (`let modelOverride`):

```typescript
let agentProfileSelectorEnabled = false;
let agentProfile: string | undefined;
```

In the cache-hit `Promise.allSettled` block (line 234), add two new calls to the array (after `modelOverrideResult` on line 247):

```typescript
checkSwitchboardFlag('appbuilder-agent-profile-selector', authContext.jwt || '', request.headers),
checkSwitchboardValue('appbuilder-agent-profile', authContext.jwt || '', request.headers),
```

Update the destructuring (add after line 260, the `modelOverride` resolution):

```typescript
agentProfileSelectorEnabled = resolveBooleanFlag(
  agentProfileSelectorResult,
  "agent-token.agent-profile-selector-flag-check-failed",
  body.siteId,
  user.customerId,
);
const rawAgentProfile = resolveStringFlag(
  agentProfileResult,
  "agent-token.agent-profile-flag-check-failed",
  body.siteId,
  user.customerId,
);
agentProfile =
  rawAgentProfile && rawAgentProfile !== "default"
    ? rawAgentProfile
    : undefined;
```

Do the same for the cache-miss `Promise.allSettled` block (line 264). Add the same two calls and the same result extraction after line 300.

Update the `tokenOptions` object (line 322-338) to include the new claims after `modelOverride` (line 337):

```typescript
agentProfileSelectorEnabled,
agentProfile,
```

- [ ] **Step 6: Configure dev Switchboard flags**

Create or update the dev Switchboard flags at:

https://switchboard.int.dev-gdcorp.tools/airo-app-builder

- `appbuilder-agent-profile-selector`: set to `true` for local testing.
- `appbuilder-agent-profile`: set to `experimental` for local testing.

Do not add code-level local overrides. Local dev reads the Switchboard development environment directly.

- [ ] **Step 7: Run typecheck to verify**

Run: `pnpm --filter website typecheck`
Expected: PASS (no type errors)

- [ ] **Step 8: Commit**

```bash
git add app/src/lib/jwt-config.ts app/src/lib/jwt-service.ts app/src/app/api/auth/agent-token/route.ts app/src/lib/switchboard/server.ts app/src/hooks/useSwitchboard.ts
git commit -m "feat(profiles): add agent profile Switchboard flags and JWT claims in BFF"
```

---

### Task 9: Frontend Store & WebSocket Metadata

**Files:**

- Modify: `app/src/stores/useDevelopPageStore.ts:182,255,430,721`
- Modify: `app/src/services/websocket/ChatMessageBuilder.ts:36-56,221-247`
- Modify: `app/src/services/websocket/StreamingWebSocketController.ts:401-485`
- Modify: `app/src/hooks/useStreamingWebSocket.ts:71-98,370-388`

- [ ] **Step 1: Add selectedProfile to the store**

In `app/src/stores/useDevelopPageStore.ts`:

Add to the state interface after `selectedModel: string | null` (line 182):

```typescript
selectedProfile: string | null;
```

Add to the setters section after `setSelectedModel` (line 255):

```typescript
setSelectedProfile: (profile: string | null) => void
```

Add the setter implementation after `setSelectedModel` (line 430):

```typescript
setSelectedProfile: (profile) => set((state) => { state.selectedProfile = profile }),
```

Add `selectedProfile` initialization in the store's initial state (near line 182, where `selectedModel` is initialized to `null`):

```typescript
selectedProfile: null,
```

Add reset in `resetForNewApp` after `state.selectedModel = null` (line 721):

```typescript
state.selectedProfile = null;
```

- [ ] **Step 2: Add agentProfile to BuildMessageParams**

In `app/src/services/websocket/ChatMessageBuilder.ts`, add to `BuildMessageParams` interface after `modelOverride?: string` (line 55):

```typescript
agentProfile?: string
```

In `buildRichContext` method, add to the metadata spread after `modelOverride` (line 232):

```typescript
...(params.agentProfile && { agentProfile: params.agentProfile }),
```

- [ ] **Step 3: Add agentProfile to controller sendMessage**

In `app/src/services/websocket/StreamingWebSocketController.ts`, add to the `sendMessage` params type after `modelOverride?: string` (line 410):

```typescript
agentProfile?: string
```

In the `messageParams` object construction (after line 484, `modelOverride`):

```typescript
agentProfile: params.agentProfile,
```

- [ ] **Step 4: Add agentProfile to SendMessageOptions and resolution**

In `app/src/hooks/useStreamingWebSocket.ts`, add to `SendMessageOptions` interface after `modelOverride?: string` (line 97):

```typescript
agentProfile?: string
```

In the `sendMessage` callback, add profile resolution after model override resolution (after line 376):

```typescript
let resolvedProfile = options.agentProfile;
if (resolvedProfile === undefined) {
  const { useDevelopPageStore } = await import("@/stores/useDevelopPageStore");
  resolvedProfile = useDevelopPageStore.getState().selectedProfile ?? undefined;
}
```

Add `agentProfile: resolvedProfile` to the `controller.sendMessage()` call (after `modelOverride: resolvedModelOverride` on line 387):

```typescript
agentProfile: resolvedProfile,
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/src/stores/useDevelopPageStore.ts app/src/services/websocket/ChatMessageBuilder.ts app/src/services/websocket/StreamingWebSocketController.ts app/src/hooks/useStreamingWebSocket.ts
git commit -m "feat(profiles): add profile selection to store and WebSocket metadata flow"
```

---

### Task 10: ProfileSelector Component

**Files:**

- Create: `app/src/app/develop/components/settings/ProfileSelector.tsx`
- Modify: `app/src/app/develop/components/settings/ProjectPanel.tsx:12,186`

- [ ] **Step 1: Create the ProfileSelector component**

Create `app/src/app/develop/components/settings/ProfileSelector.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import Alert from "@ux/alert";
import Select from "@ux/select";
import Spinner from "@ux/spinner";

import SettingsSection from "@/app/develop/components/settings/SettingsSection";
import { useAppIdFromParams } from "@/app/develop/components/utils";
import { buildDynamicAgentUrl } from "@/config/dynamic-api";
import { useSwitchboard } from "@/hooks/useSwitchboard";
import { useTranslations } from "@/hooks/useTranslations";
import { agentFetch } from "@/lib/agent-fetch";
import { useDevelopPageStore } from "@/stores/useDevelopPageStore";

interface ProfileInfo {
  name: string;
  description: string;
  properties: Record<string, string | number | boolean | null>;
}

function useAvailableProfiles(siteId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["agent-profiles", siteId],
    queryFn: async () => {
      if (!siteId) throw new Error("No siteId");
      const url = await buildDynamicAgentUrl("profiles", siteId);
      const response = await agentFetch(url, { siteId });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error || `Failed to fetch profiles (${response.status})`,
        );
      }
      return response.json() as Promise<{ profiles: ProfileInfo[] }>;
    },
    enabled: enabled && !!siteId,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export default function ProfileSelector() {
  const t = useTranslations();
  const appId = useAppIdFromParams();
  const {
    data: isEnabled,
    isLoading: isFlagLoading,
    error: flagError,
  } = useSwitchboard("appbuilder-agent-profile-selector");

  const selectedProfile = useDevelopPageStore((s) => s.selectedProfile);
  const setSelectedProfile = useDevelopPageStore((s) => s.setSelectedProfile);

  const {
    data: profilesData,
    isLoading: isProfilesLoading,
    error,
  } = useAvailableProfiles(appId, !!isEnabled);

  if (isFlagLoading) return null;
  if (!isEnabled && !flagError) return null;

  const profiles = profilesData?.profiles ?? [];

  return (
    <SettingsSection
      title={t(
        "builder_settings_agent_profile_title",
        undefined,
        "Agent Profile",
      )}
      hideStatus
      description={t(
        "builder_settings_agent_profile_desc",
        undefined,
        'Override the agent configuration for this project. "Default" uses the standard configuration.',
      )}
    >
      {flagError ? (
        <Alert emphasis="critical" data-testid="profile-selector-flag-error">
          {t(
            "builder_settings_agent_profile_flag_error",
            undefined,
            "Unable to check profile selector availability",
          )}
        </Alert>
      ) : isProfilesLoading ? (
        <Spinner size="sm" />
      ) : error ? (
        <Alert emphasis="critical" data-testid="profile-selector-error">
          {error.message}
        </Alert>
      ) : (
        <Select
          id="agent-profile-select"
          name="agent-profile"
          label={t(
            "builder_settings_agent_profile_label",
            undefined,
            "Agent Profile",
          )}
          value={selectedProfile ?? ""}
          onChange={(value: string) => setSelectedProfile(value || null)}
          visualSize="md"
          data-testid="profile-selector"
        >
          <option value="">
            {t("builder_settings_agent_profile_default", undefined, "Default")}
          </option>
          {profiles.map((profile) => (
            <option
              key={profile.name}
              value={profile.name}
              title={profile.description}
            >
              {profile.name}
            </option>
          ))}
        </Select>
      )}
    </SettingsSection>
  );
}
```

- [ ] **Step 2: Add to ProjectPanel**

In `app/src/app/develop/components/settings/ProjectPanel.tsx`:

Add import after the `ModelSelector` import (line 12):

```typescript
import ProfileSelector from "@/app/develop/components/settings/ProfileSelector";
```

Add `<ProfileSelector />` after `<ModelSelector />` (line 186):

```tsx
<ProfileSelector />
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter website typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add app/src/app/develop/components/settings/ProfileSelector.tsx app/src/app/develop/components/settings/ProjectPanel.tsx
git commit -m "feat(profiles): add ProfileSelector UI component"
```

---

### Task 11: Model Selection Integration

**Files:**

- Modify: `agents/src/utils/model-selection.ts:166-202`

- [ ] **Step 1: Add profile-based model fallback**

In `agents/src/utils/model-selection.ts`, add import at the top:

```typescript
import { profileValue } from "../profiles/index.js";
```

In `getAgentModel()` (line 166), after the existing override check (lines 169-202) and before the provider availability check (line 204), add a profile-based model fallback. Insert after the closing `}` on line 202:

```typescript
// Check profile for model default (lower priority than explicit overrides)
const profileModel = profileValue("model.default", "");
if (profileModel) {
  logger.info("model.profile.active", {
    profileModel,
    tier,
  });

  try {
    const model = await getModel(profileModel);
    const modelInfo = getModelInfo(profileModel);
    logger.info("model.profile.success", {
      tier,
      profileModel,
      modelInfo: {
        shortName: modelInfo.shortName,
        fullName: modelInfo.fullName,
        provider: modelInfo.provider,
        usingProxy: modelInfo.usingProxy,
      },
    });
    return await wrapWithDevTools(model);
  } catch (error) {
    logger.warn("model.profile.failure", {
      tier,
      profileModel,
      error: error instanceof Error ? error.message : String(error),
      message: "Falling back to default model selection",
    });
  }
}
```

Do the same for `getAgentModelWithName()` (line 277) — add the same profile check after its override check block, adapting to return `{ model, modelName }`:

```typescript
const profileModel = profileValue("model.default", "");
if (profileModel) {
  logger.info("model.profile.active", { profileModel, tier });
  try {
    const model = await getModel(profileModel);
    return { model: await wrapWithDevTools(model), modelName: profileModel };
  } catch (error) {
    logger.warn("model.profile.failure", {
      tier,
      profileModel,
      error: error instanceof Error ? error.message : String(error),
      message: "Falling back to default model selection",
    });
  }
}
```

- [ ] **Step 2: Run existing model selection tests**

Run: `pnpm --filter @airo/agents test:unit "model-selection"`
Expected: PASS (profile check returns empty string default, no-op)

- [ ] **Step 3: Commit**

```bash
git add agents/src/utils/model-selection.ts
git commit -m "feat(profiles): add profile-based model default in model selection"
```

---

### Task 12: Full Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all agents unit tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All PASS

- [ ] **Step 2: Run all app tests**

Run: `pnpm --filter website test`
Expected: All PASS

- [ ] **Step 3: Run typecheck across all packages**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: PASS
