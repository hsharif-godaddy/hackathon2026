# Design: Callback-based initial skill loading

## Problem

The `initialSkills` mechanism in `agent-factory.ts` (framework layer) needs to do the same work as the `skill({ action: 'load' })` tool (domain layer): register tools, load instructions, and run lifecycle hooks. The current PR pushes domain logic (`loadSkill`, instruction reading) into the `SkillToolProvider` interface, breaking the package boundary between `ai-lib` (framework) and `agents` (domain).

The root cause: skill loading is a three-step domain operation (instructions + tools + hooks) orchestrated by `skill-loader.ts`. The framework shouldn't know about these steps — it should delegate to the domain layer.

## Solution

Replace `initialSkills: string[]` and the `loadSkill` interface addition with a generic `onSkillsLoad` callback on `AgentConfig`. The framework calls the callback once per conversation and injects the returned context messages. All skill loading logic stays in the agents layer.

## Design

### 1. `AgentConfig.onSkillsLoad` callback

```typescript
// In packages/ai-lib/src/core/types.ts (AgentConfig)
onSkillsLoad?: (conversationId: string) => Promise<PipelineContextMessage[]>
```

The callback receives a `conversationId` and returns context messages to inject. The framework:

- Calls it once per conversation (tracks in `onSkillsLoadedConversations: Set<string>`)
- Injects returned messages into `contextMessages` before the pipeline runs
- Messages use `insertionOrder: 'after_history'` to avoid cache invalidation

The callback is generic. It doesn't know about skills. Any agent could use it to inject first-conversation context.

### 2. Framework changes (`agent-factory.ts`)

In `prepareCall`, before the pipeline transform:

```typescript
const executionContext = callOptions.executionContext as
  | Record<string, any>
  | undefined;
this.currentConversationId = executionContext?.metadata?.conversationId as
  | string
  | undefined;

const contextMessages = [...(callOptions.contextMessages ?? [])];
if (
  this.currentConversationId &&
  this.config.onSkillsLoad &&
  !this.onSkillsLoadedConversations.has(this.currentConversationId)
) {
  try {
    const skillMessages = await this.config.onSkillsLoad(
      this.currentConversationId,
    );
    contextMessages.push(...skillMessages);
    this.onSkillsLoadedConversations.add(this.currentConversationId);
  } catch (error) {
    logger.warn("agent.on_skills_load.failed", {
      agentName: this.config.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Then pipeline runs with contextMessages...
```

Remove:

- `initialSkills` from `AgentConfig`
- `loadSkill` from `SkillToolProvider` interface
- `initialSkillsRegisteredConversations` field (replaced by `onSkillsLoadedConversations`)
- The old initialSkills registration block in prepareCall

### 3. Domain layer wiring (`initial-agent.ts`)

```typescript
// In createInitialAgent(), for logo-designer template:
const onSkillsLoad =
  templateId === "logo-designer"
    ? async (conversationId: string) => {
        const result = await skillToolManager.loadSkill(
          "media-logo",
          conversationId,
        );
        if (!result.success || !result.instructions) return [];
        return [
          {
            role: "system" as const,
            content: result.instructions,
            insertionOrder: "after_history" as const,
          },
        ];
      }
    : undefined;

return {
  // ...agent config...
  onSkillsLoad,
  // Remove: initialSkills: templateId === 'logo-designer' ? ['media-logo'] : undefined,
};
```

Remove the manual `skill.md` injection from `buildInitialSystemPrompt()` (lines 71-77).

### 4. Unified skill loading in `SkillToolManager.loadSkill()`

Already implemented. Does: `registerSkill()` + read `skill.md` + `runHook('onLoad')`. Used by both:

- `onSkillsLoad` callback (initial load)
- `skill-loader.ts` (LLM-driven load via skill tool)

### 5. `SkillToolProvider` interface stays clean

```typescript
export interface SkillToolProvider {
  getAllTools: () => Record<string, Tool>;
  getSkillToolNames: () => string[];
  getActiveToolNames: (conversationId: string) => string[];
  updateSkillUsage: (
    conversationId: string,
    skillName: string,
    stepNumber: number,
  ) => void;
  cleanupInactiveSkills: (
    conversationId: string,
    currentStep: number,
  ) => string[];
  registerSkill?: (
    skillName: string,
    conversationId: string,
  ) => { success: boolean; tools: string[] };
  // No loadSkill — that's a domain concern
}
```

## Files to modify

| File                                                              | Change                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/ai-lib/src/core/types.ts`                               | Add `onSkillsLoad` to `AgentConfig`, remove `initialSkills`, remove `loadSkill` from `SkillToolProvider` |
| `packages/ai-lib/src/core/agent-factory.ts`                       | Replace initialSkills block with onSkillsLoad callback, rename tracking Set                              |
| `agents/src/agents/initial-agent.ts`                              | Wire `onSkillsLoad` callback, remove manual skill.md injection                                           |
| `agents/src/tools/skill-tool-manager.ts`                          | `loadSkill()` stays (already added)                                                                      |
| `agents/src/tools/ai-lib-tools/skill-loader.ts`                   | Already refactored to use `skillToolManager.loadSkill()`                                                 |
| `packages/ai-lib/src/core/__tests__/agent-factory-skills.test.ts` | Update tests for `onSkillsLoad` callback                                                                 |
| `agents/src/agents/__tests__/initial-agent.test.ts`               | Update if initialSkills assertions exist                                                                 |

## Verification

1. `pnpm --filter @airo/ai-lib test -- --run` — ai-lib tests pass
2. `pnpm --filter @airo/agents test:unit` — agents tests pass
3. `pnpm typecheck && pnpm lint && pnpm build` — all pass
4. Logo-designer agent receives media-logo instructions in conversation context
