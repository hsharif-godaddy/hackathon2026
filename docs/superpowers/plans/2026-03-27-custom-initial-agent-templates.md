# Custom Initial Agent Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the initial agent's system prompt to be replaced by a registered template, selected via `templateId` in the WebSocket message metadata.

**Architecture:** Template prompts live as markdown files in `agents/src/prompts/initial/templates/<templateId>/`. A registry maps template IDs to metadata. Template-specific initial agents are pre-created at startup with unique agent IDs (`initial-<templateId>`) and registered alongside the default initial agent. The `agentRouter` reads `templateId` from WebSocket message metadata and routes to the appropriate agent variant.

**Tech Stack:** TypeScript, Vitest, existing prompt builder system (`createPromptBuilder`), existing agent factory (`createUnifiedAgentFactory`)

---

## File Structure

| File                                                         | Action | Responsibility                                            |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------- |
| `agents/src/agents/template-registry.ts`                     | Create | Template ID → metadata mapping                            |
| `agents/src/agents/__tests__/template-registry.test.ts`      | Create | Registry tests                                            |
| `agents/src/prompts/initial/templates/business-plan/core.md` | Create | Placeholder template prompt                               |
| `agents/src/agents/initial-agent.ts`                         | Modify | Accept optional `templateId`, load template prompt files  |
| `agents/src/agents/__tests__/initial-agent.test.ts`          | Modify | Add template-aware tests                                  |
| `agents/src/agents/ai-lib-agents/index.ts`                   | Modify | Pre-create template agent variants, register with factory |
| `agents/src/server/ai-lib-websocket-server.ts`               | Modify | Read `templateId` from metadata, route to template agent  |
| `packages/ai-lib/src/tools/handoff-helpers.ts`               | Modify | Extend metadata type to include `templateId`              |
| `packages/ai-lib/src/tools/handoff-state-manager.ts`         | Modify | Store/retrieve `templateId` in session state              |

---

### Task 1: Template Registry

**Files:**

- Create: `agents/src/agents/template-registry.ts`
- Test: `agents/src/agents/__tests__/template-registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `agents/src/agents/__tests__/template-registry.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  templateRegistry,
  getTemplate,
  getTemplateIds,
} from "../template-registry.js";

describe("template-registry", () => {
  describe("templateRegistry", () => {
    it("should contain business-plan template", () => {
      expect(templateRegistry["business-plan"]).toBeDefined();
      expect(templateRegistry["business-plan"].id).toBe("business-plan");
      expect(templateRegistry["business-plan"].name).toBe(
        "Business Plan Website",
      );
      expect(templateRegistry["business-plan"].description).toBeTruthy();
    });
  });

  describe("getTemplate", () => {
    it("should return template by id", () => {
      const template = getTemplate("business-plan");
      expect(template).toBeDefined();
      expect(template!.id).toBe("business-plan");
    });

    it("should return undefined for unknown template", () => {
      expect(getTemplate("nonexistent")).toBeUndefined();
    });
  });

  describe("getTemplateIds", () => {
    it("should return all registered template ids", () => {
      const ids = getTemplateIds();
      expect(ids).toContain("business-plan");
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "template-registry"`
Expected: FAIL — module not found

- [ ] **Step 3: Write the template registry**

Create `agents/src/agents/template-registry.ts`:

```typescript
/**
 * Template Registry — maps template IDs to metadata.
 *
 * Each registered template must have a corresponding prompt directory at:
 *   agents/src/prompts/initial/templates/<templateId>/core.md
 */

export interface InitialAgentTemplate {
  id: string;
  name: string;
  description: string;
}

export const templateRegistry: Record<string, InitialAgentTemplate> = {
  "business-plan": {
    id: "business-plan",
    name: "Business Plan Website",
    description: "Guides the user through creating a business plan website",
  },
};

/**
 * Get a template by ID, or undefined if not registered.
 */
export function getTemplate(
  templateId: string,
): InitialAgentTemplate | undefined {
  return templateRegistry[templateId];
}

/**
 * Get all registered template IDs.
 */
export function getTemplateIds(): string[] {
  return Object.keys(templateRegistry);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "template-registry"`
Expected: PASS — all 4 tests green

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/template-registry.ts agents/src/agents/__tests__/template-registry.test.ts
git commit -m "feat: add initial agent template registry"
```

---

### Task 2: Placeholder Business Plan Template Prompt

**Files:**

- Create: `agents/src/prompts/initial/templates/business-plan/core.md`

- [ ] **Step 1: Create template directory and placeholder prompt**

Create `agents/src/prompts/initial/templates/business-plan/core.md`:

```markdown
# Business Plan Website Builder

You are a website builder specializing in business plan websites. You help users create professional business plan websites that communicate their business vision, model, and strategy.

## YOUR WORKFLOW

1. Ask the user about their business (name, industry, stage, target audience)
2. Set the project name using the setProjectName tool
3. Create a design plan using the todoList tool
4. Hand off to the develop agent using the handoff tool

## RULES

- Ask ONE question at a time using the askQuestion tool
- Be concise — no verbose explanations
- After gathering enough information (2-3 questions max), proceed to planning
- The handoff prompt must include all gathered business details and design direction

<!-- TODO: Replace this placeholder with the full business plan template prompt -->
```

- [ ] **Step 2: Commit**

```bash
git add agents/src/prompts/initial/templates/business-plan/core.md
git commit -m "feat: add placeholder business-plan template prompt"
```

---

### Task 3: Extend Session Metadata to Support templateId

**Files:**

- Modify: `packages/ai-lib/src/tools/handoff-helpers.ts:24-32`
- Modify: `packages/ai-lib/src/tools/handoff-state-manager.ts:68-92,374-399`

- [ ] **Step 1: Extend the HandoffStateManager metadata type**

In `packages/ai-lib/src/tools/handoff-helpers.ts`, update lines 30 and 32:

```typescript
// Before:
  setSessionMetadata?: (sessionId: string, metadata: { appId?: string }) => void
  getSessionMetadata?: (sessionId: string) => { appId?: string } | undefined

// After:
  setSessionMetadata?: (sessionId: string, metadata: { appId?: string; templateId?: string }) => void
  getSessionMetadata?: (sessionId: string) => { appId?: string; templateId?: string } | undefined
```

- [ ] **Step 2: Extend SessionState to include templateId**

In `packages/ai-lib/src/tools/handoff-state-manager.ts`, add to the `SessionState` interface (after line 91):

```typescript
  /** Template ID for customizing the initial agent prompt */
  templateId?: string
```

- [ ] **Step 3: Update setSessionMetadata to store templateId**

In `packages/ai-lib/src/tools/handoff-state-manager.ts`, update `setSessionMetadata` (around line 391):

```typescript
  setSessionMetadata(sessionId: string, metadata: { appId?: string; templateId?: string }): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      if (metadata.appId) {
        session.appId = metadata.appId
      }
      if (metadata.templateId) {
        session.templateId = metadata.templateId
      }
      session.lastActivityAt = new Date()
    }
  }
```

- [ ] **Step 4: Update getSessionMetadata to return templateId**

In `packages/ai-lib/src/tools/handoff-state-manager.ts`, update `getSessionMetadata` (around line 374):

```typescript
  getSessionMetadata(sessionId: string): { appId?: string; templateId?: string } | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined

    const metadata: { appId?: string; templateId?: string } = {}
    if (session.appId) {
      metadata.appId = session.appId
    }
    if (session.templateId) {
      metadata.templateId = session.templateId
    }
    return metadata
  }
```

- [ ] **Step 5: Run existing ai-lib tests to verify no breakage**

Run: `pnpm --filter @airo/ai-lib test`
Expected: PASS — all existing tests still green (the new field is optional so no existing code breaks)

- [ ] **Step 6: Commit**

```bash
git add packages/ai-lib/src/tools/handoff-helpers.ts packages/ai-lib/src/tools/handoff-state-manager.ts
git commit -m "feat: extend session metadata to support templateId"
```

---

### Task 4: Make createInitialAgent Template-Aware

**Files:**

- Modify: `agents/src/agents/initial-agent.ts`
- Modify: `agents/src/agents/__tests__/initial-agent.test.ts`

- [ ] **Step 1: Write the failing test for template support**

Add to `agents/src/agents/__tests__/initial-agent.test.ts`, inside the `describe('#createInitialAgent')` block:

```typescript
it("should create agent with template-specific id when templateId is provided", async function templateId() {
  const config = await createInitialAgent(undefined, "business-plan");

  expect(config.id).toBe("initial-business-plan");
  expect(config.name).toBe("Initial (business-plan)");
});

it("should throw for unknown templateId", async function unknownTemplate() {
  await expect(createInitialAgent(undefined, "nonexistent")).rejects.toThrow(
    "Unknown template: nonexistent",
  );
});

it("should keep default id when no templateId is provided", async function defaultId() {
  const config = await createInitialAgent();

  expect(config.id).toBe("initial");
  expect(config.name).toBe("Initial");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "initial-agent"`
Expected: FAIL — `createInitialAgent` doesn't accept second argument / wrong id

- [ ] **Step 3: Implement template-aware prompt building and agent creation**

Update `agents/src/agents/initial-agent.ts`:

```typescript
import {
  type AgentConfig,
  createPromptBuilder,
  createHandoffTool,
  type SessionStateManager,
} from "@airo/ai-lib";
import { existsSync } from "fs";
import { getAgentModelWithName } from "../utils/model-selection.js";
import { getModularPromptPaths } from "../utils/prompt-utils.js";
import { allAILibTools } from "../tools/ai-lib-tools/index.js";
import { createAgentTelemetryLogger } from "../utils/agent-logger.js";
import { getTemplate } from "./template-registry.js";

/**
 * Initial Agent - Creates single-page preview plans for new apps
 *
 * This agent is only used for brand new apps with no conversation history.
 * It creates a minimal todo list for a single-page preview and hands off to develop agent.
 *
 * Prompt structure (default):
 * - core.md: Core role, workflow, and rules
 * - attributes.md: Attribute discovery for personalization
 * - guidelines.md: Detailed planning instructions
 * - examples.md: Pattern demonstrations
 * - security.md: Content restrictions
 *
 * When a templateId is provided, prompt files are loaded from
 * agents/src/prompts/initial/templates/<templateId>/ instead.
 */

const OPTIONAL_PROMPT_FILES = ["attributes.md", "guidelines.md", "examples.md"];

/**
 * Build the system prompt for the Initial Agent
 */
async function buildInitialSystemPrompt(templateId?: string): Promise<string> {
  const promptBuilder = createPromptBuilder();
  const paths = getModularPromptPaths(import.meta.url);

  if (templateId) {
    // Template mode: load from templates/<templateId>/
    const templateDir = `initial/templates/${templateId}`;
    promptBuilder.file(paths.getAgentFile(templateDir, "core.md"));

    for (const file of OPTIONAL_PROMPT_FILES) {
      const filePath = paths.getAgentFile(templateDir, file);
      if (existsSync(filePath)) {
        promptBuilder.file(filePath);
      }
    }
  } else {
    // Default mode: existing behavior
    promptBuilder.file(paths.getAgentFile("initial", "core.md"));
    promptBuilder.file(paths.getAgentFile("initial", "attributes.md"));
    promptBuilder.file(paths.getAgentFile("initial", "guidelines.md"));
    promptBuilder.file(paths.getAgentFile("initial", "examples.md"));
  }

  // Shared files always included
  promptBuilder.file(paths.getSharedFile("communication.md"));
  promptBuilder.file(paths.getSharedFile("security.md"));

  return await promptBuilder.build();
}

/**
 * Create the Initial Agent configuration
 * @param stateManager - Optional session state manager for handoff support
 * @param templateId - Optional template ID to use a custom system prompt
 */
export async function createInitialAgent(
  stateManager?: SessionStateManager,
  templateId?: string,
): Promise<AgentConfig> {
  if (templateId && !getTemplate(templateId)) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const systemPrompt = await buildInitialSystemPrompt(templateId);
  const { model, modelName } = await getAgentModelWithName("fast");

  const agentId = templateId ? `initial-${templateId}` : "initial";
  const agentName = templateId ? `Initial (${templateId})` : "Initial";

  const handoffTool = stateManager
    ? createHandoffTool({
        sourceAgentId: agentId,
        validTargets: ["develop"],
        stateManager,
      })
    : undefined;

  const tools: Record<string, unknown> = {
    todoList: allAILibTools.todoList,
    setProjectName: allAILibTools.setProjectName,
    askQuestion: allAILibTools.askQuestion,
    websiteRebuild: allAILibTools.websiteRebuild,
  };

  if (handoffTool) {
    tools.handoff = handoffTool;
  }

  return {
    id: agentId,
    name: agentName,
    system: systemPrompt,
    model,
    modelName,
    tools,

    handoffs: [
      {
        agentName: "develop",
        description:
          "Hand off to development agent for all site types - single-page, multi-page, dashboards, games, or apps",
      },
    ],

    // Stop after websiteRebuild or askQuestion tools
    stopAfterTools: handoffTool
      ? ["handoff", "websiteRebuild", "askQuestion"]
      : ["websiteRebuild", "askQuestion"],

    maxSteps: 10,
    temperature: 0.5,
    maxOutputTokens: 8000,
    timeout: { stepMs: 300_000 },
    providerOptions: {
      anthropic: {
        effort: "low",
      },
    },
    logger: createAgentTelemetryLogger(agentId),

    // Enable prompt caching for cost savings
    enablePromptCaching: true,

    metadata: {
      contextPreferences: {
        includeAppContext: true,
        includeVisualContext: false,
        includeAiEditContext: false,
        includeSelectedImages: false,
        includeConversationHistory: true,
        includeTemplateDescription: true,
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "initial-agent"`
Expected: PASS — all existing tests still pass, 3 new tests pass

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/initial-agent.ts agents/src/agents/__tests__/initial-agent.test.ts
git commit -m "feat: make createInitialAgent template-aware"
```

---

### Task 5: Register Template Agents in the Factory

**Files:**

- Modify: `agents/src/agents/ai-lib-agents/index.ts:43-123`

- [ ] **Step 1: Import the template registry**

At the top of `agents/src/agents/ai-lib-agents/index.ts`, add import:

```typescript
import { getTemplateIds } from "../template-registry.js";
```

- [ ] **Step 2: Pre-create template agent variants and register them**

In `createUnifiedAgentFactory()`, after line 66 (`const initialConfig = await createInitialAgent(stateManager)`) and before the handoff tool creation section, add:

```typescript
// Pre-create template-specific initial agent variants
const templateInitialConfigs: Record<string, AgentConfig> = {};
for (const templateId of getTemplateIds()) {
  templateInitialConfigs[`initial-${templateId}`] = await createInitialAgent(
    stateManager,
    templateId,
  );
}
```

Then update the `agentDefinitions` record (around line 113) to include template agents:

```typescript
// Build agent definitions conditionally
const agentDefinitions: Record<string, AgentConfig> = {
  initial: initialConfig,
  develop: developConfig,
  marketing: marketingConfig,
  ...templateInitialConfigs,
};
```

- [ ] **Step 3: Add context pipeline to template agents**

After `initialConfig.contextPipeline = contextPipeline` (around line 110), add:

```typescript
for (const config of Object.values(templateInitialConfigs)) {
  config.contextPipeline = contextPipeline;
}
```

- [ ] **Step 4: Run typecheck to verify**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS — no type errors

- [ ] **Step 5: Commit**

```bash
git add agents/src/agents/ai-lib-agents/index.ts
git commit -m "feat: register template initial agents in factory"
```

---

### Task 6: Route to Template Agent in WebSocket Server

**Files:**

- Modify: `agents/src/server/ai-lib-websocket-server.ts:1081-1175`

- [ ] **Step 1: Update agentRouter to read templateId and route to template agent**

In `agents/src/server/ai-lib-websocket-server.ts`, update the `isNewApp` block in `agentRouter` (around line 1143):

```typescript
if (isNewApp) {
  const templateId = metadata?.templateId as string | undefined;
  const agentId = templateId ? `initial-${templateId}` : "initial";

  logger.info("websocket.agent_router.initial_selected", {
    socketId,
    appId,
    templateId: templateId || null,
    agentId,
    message:
      "New app detected, routing to initial agent and setting session state",
  });

  // Set the initial agent in session state so subsequent messages continue with it
  // This ensures the initial agent receives follow-up messages (like attribute answers)
  // until it explicitly hands off to develop agent
  stateManager.switchAgent(socketId, agentId).catch((error) => {
    logger.error("websocket.agent_router.session_state_error", {
      socketId,
      appId,
      templateId: templateId || null,
      error: error instanceof Error ? error.message : String(error),
      message: "Failed to set initial agent in session state",
    });
  });

  // Also set the appId and templateId in session metadata for tracking
  stateManager.setSessionMetadata?.(socketId, { appId, templateId });

  return agentId;
}
```

This replaces the existing `if (isNewApp)` block (lines 1143-1166).

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: PASS

- [ ] **Step 3: Run the full test suite to verify no breakage**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS — all existing tests still green

- [ ] **Step 4: Commit**

```bash
git add agents/src/server/ai-lib-websocket-server.ts
git commit -m "feat: route to template initial agent based on templateId in metadata"
```

---

### Task 7: End-to-End Verification

- [ ] **Step 1: Run full typecheck across all packages**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full lint across all packages**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all agent tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: PASS

- [ ] **Step 4: Run ai-lib tests**

Run: `pnpm --filter @airo/ai-lib test`
Expected: PASS

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: PASS
