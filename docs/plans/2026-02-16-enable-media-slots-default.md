# Enable Media Slots by Default Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the `mediaSearch` tool and `ENABLE_MEDIA_SLOTS` feature flag, making media slots the default and only media tool across all agents.

**Architecture:** Delete old `mediaSearch` implementation files, update all agent configurations to use `media` (slots) tool, remove feature flag from features.ts, and update related tests/documentation.

**Tech Stack:** TypeScript, Vitest, React

---

## Task 1: Delete Old Media Search Implementation Files

**Files:**

- Delete: `agents/src/tools/media-search-tool.ts`
- Delete: `agents/src/tools/ai-lib-tools/media-tools.ts`

**Step 1: Delete media-search-tool.ts**

```bash
rm agents/src/tools/media-search-tool.ts
```

**Step 2: Delete media-tools.ts (AI-lib wrapper)**

```bash
rm agents/src/tools/ai-lib-tools/media-tools.ts
```

**Step 3: Verify files are deleted**

Run: `ls agents/src/tools/media-search-tool.ts agents/src/tools/ai-lib-tools/media-tools.ts 2>&1`
Expected: "No such file or directory" for both

**Step 4: Commit**

```bash
git add -A && git commit -m "chore: delete old mediaSearch tool implementation files"
```

---

## Task 2: Update AI-Lib Tools Index

**Files:**

- Modify: `agents/src/tools/ai-lib-tools/index.ts`

**Step 1: Remove mediaSearchAITool export**

Remove this line from exports section (~line 15):

```typescript
export { mediaSearchAITool } from "./media-tools.js";
```

**Step 2: Remove mediaSearchAITool import**

Remove this line from imports section (~line 71):

```typescript
import { mediaSearchAITool } from "./media-tools.js";
```

**Step 3: Remove mediaSearch from allAILibTools registry**

Remove this line from `allAILibTools` object (~line 131):

```typescript
mediaSearch: mediaSearchAITool,
```

**Step 4: Remove mediaSearch from toolGroups.media**

In `toolGroups.media` object (~line 219), remove:

```typescript
mediaSearch: mediaSearchAITool,
```

Keep `mediaSlot: mediaSlotAITool` in the media group.

**Step 5: Verify TypeScript compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: No errors (may have errors from other files - fix in subsequent tasks)

**Step 6: Commit**

```bash
git add agents/src/tools/ai-lib-tools/index.ts && git commit -m "chore: remove mediaSearch from AI-lib tools registry"
```

---

## Task 3: Remove Feature Flag from Features Service

**Files:**

- Modify: `agents/src/services/features.ts`

**Step 1: Remove mediaSlots from enabledFeatures interface**

In `FeatureConfig` interface (~line 68-73), change:

```typescript
// Widget/Feature enablement configuration
enabledFeatures: {
  sessionFeedback: boolean;
  imageAnalysisEnabled: boolean;
  mediaSlots: boolean;
}
```

To:

```typescript
// Widget/Feature enablement configuration
enabledFeatures: {
  sessionFeedback: boolean;
  imageAnalysisEnabled: boolean;
}
```

**Step 2: Remove mediaSlots from parseEnvironmentFeatures**

In `parseEnvironmentFeatures` function (~line 231-235), change:

```typescript
// Widget/Feature enablement configuration
enabledFeatures: {
  sessionFeedback: process.env.ENABLE_SESSION_FEEDBACK === 'true',
  imageAnalysisEnabled: process.env.IMAGE_ANALYSIS_ENABLED === 'true',
  mediaSlots: process.env.ENABLE_MEDIA_SLOTS === 'true'
}
```

To:

```typescript
// Widget/Feature enablement configuration
enabledFeatures: {
  sessionFeedback: process.env.ENABLE_SESSION_FEEDBACK === 'true',
  imageAnalysisEnabled: process.env.IMAGE_ANALYSIS_ENABLED === 'true'
}
```

**Step 3: Verify TypeScript compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: Error in develop-agent.ts (will fix in next task)

**Step 4: Commit**

```bash
git add agents/src/services/features.ts && git commit -m "chore: remove ENABLE_MEDIA_SLOTS feature flag"
```

---

## Task 4: Update Develop Agent

**Files:**

- Modify: `agents/src/agents/develop-agent.ts`

**Step 1: Remove featureFlags import usage**

The import `features as featureFlags` at line 17 can stay (may be used elsewhere), but remove its usage for media tools.

**Step 2: Replace conditional media tool with direct media tool**

Find this code (~lines 251-254):

```typescript
// Use slot-based media tool when ENABLE_MEDIA_SLOTS=true, otherwise use direct URL media search
...(featureFlags.isEnabled('mediaSlots')
  ? { media: allAILibTools.media }
  : { mediaSearch: allAILibTools.mediaSearch }),
```

Replace with:

```typescript
media: allAILibTools.media,
```

**Step 3: Verify TypeScript compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: Pass (or errors in other files to fix next)

**Step 4: Commit**

```bash
git add agents/src/agents/develop-agent.ts && git commit -m "feat: always use media slots tool in develop agent"
```

---

## Task 5: Update Marketing Agent

**Files:**

- Modify: `agents/src/agents/marketing-agent.ts`

**Step 1: Change mediaSearch to media in baseTools**

Find this code (~line 54):

```typescript
mediaSearch: allAILibTools.mediaSearch,
```

Replace with:

```typescript
media: allAILibTools.media,
```

**Step 2: Verify TypeScript compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: Pass

**Step 3: Commit**

```bash
git add agents/src/agents/marketing-agent.ts && git commit -m "feat: use media slots tool in marketing agent"
```

---

## Task 6: Update Commerce Agent

**Files:**

- Modify: `agents/src/agents/commerce-agent.ts`

**Step 1: Change import from media-tools to media-slot**

Find this import (~line 23):

```typescript
import { mediaSearchAITool } from "../tools/ai-lib-tools/media-tools.js";
```

Replace with:

```typescript
import { mediaSlotAITool } from "../tools/ai-lib-tools/media-slot.js";
```

**Step 2: Change mediaSearch to media in tools**

Find this code (~line 114):

```typescript
mediaSearch: mediaSearchAITool,
```

Replace with:

```typescript
media: mediaSlotAITool,
```

**Step 3: Verify TypeScript compiles**

Run: `pnpm --filter @airo/agents typecheck`
Expected: Pass

**Step 4: Commit**

```bash
git add agents/src/agents/commerce-agent.ts && git commit -m "feat: use media slots tool in commerce agent"
```

---

## Task 7: Update Marketing Agent Test

**Files:**

- Modify: `agents/src/agents/__tests__/marketing-agent.test.ts`

**Step 1: Update tool property expectation**

Find this line (~line 58):

```typescript
expect(config.tools).toHaveProperty("mediaSearch");
```

Replace with:

```typescript
expect(config.tools).toHaveProperty("media");
```

**Step 2: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit -- "marketing-agent"`
Expected: All tests pass

**Step 3: Commit**

```bash
git add agents/src/agents/__tests__/marketing-agent.test.ts && git commit -m "test: update marketing agent test for media tool"
```

---

## Task 8: Delete MediaSearchToolRenderer

**Files:**

- Delete: `app/src/app/develop/components/tool-renderers/MediaSearchToolRenderer.tsx`

**Step 1: Delete the renderer file**

```bash
rm app/src/app/develop/components/tool-renderers/MediaSearchToolRenderer.tsx
```

**Step 2: Verify file is deleted**

Run: `ls app/src/app/develop/components/tool-renderers/MediaSearchToolRenderer.tsx 2>&1`
Expected: "No such file or directory"

**Step 3: Commit**

```bash
git add -A && git commit -m "chore: delete MediaSearchToolRenderer"
```

---

## Task 9: Update Tool Renderer Index

**Files:**

- Modify: `app/src/app/develop/components/tool-renderers/index.ts`

**Step 1: Remove MediaSearchToolRenderer import**

Find and remove this line (~line 23):

```typescript
import MediaSearchToolRenderer from "./MediaSearchToolRenderer";
```

**Step 2: Remove mediaSearch from toolRendererRegistry**

Find and remove this line from `toolRendererRegistry` object (~line 70):

```typescript
mediaSearch: MediaSearchToolRenderer,
```

**Step 3: Remove MediaSearchToolRenderer from exports**

Find and remove from the export block (~line 133):

```typescript
MediaSearchToolRenderer,
```

**Step 4: Verify TypeScript compiles**

Run: `pnpm --filter website typecheck`
Expected: Pass

**Step 5: Commit**

```bash
git add app/src/app/develop/components/tool-renderers/index.ts && git commit -m "chore: remove MediaSearchToolRenderer from registry"
```

---

## Task 10: Update Tool Name Mapping

**Files:**

- Modify: `app/src/utils/toolNameMapping.ts`

**Step 1: Remove mediaSearch case**

Find and remove these lines (~lines 34-36):

```typescript
case 'media_search':
case 'mediaSearch':
  return 'Media'
```

The `media` tool name will fall through to auto-format as "Media" anyway.

**Step 2: Update test file if exists**

Run: `pnpm --filter website test -- "toolNameMapping" 2>&1 || echo "No test or test passed"`
Expected: Pass or no test file

**Step 3: Commit**

```bash
git add app/src/utils/toolNameMapping.ts && git commit -m "chore: remove mediaSearch from tool name mapping"
```

---

## Task 11: Update Blog Writing Skill

**Files:**

- Modify: `agents/src/skills/blog-writing/skill.md`

**Step 1: Replace mediaSearch with media tool**

Find all occurrences of `mediaSearch` and replace with `media`. Key locations:

Line ~114-120:

```markdown
**You MUST call mediaSearch FIRST:**
```

mediaSearch({
query: "specific search terms related to blog topic",
count: 3
})

```

```

Replace with:

```markdown
**You MUST call media FIRST:**
```

media({
slot: "blog/featured-image",
query: "specific search terms related to blog topic",
count: 3
})

```

```

Line ~284-285:

```markdown
Every post MUST have a featured image. Always call `mediaSearch` first.
```

Replace with:

```markdown
Every post MUST have a featured image. Always call `media` first.
```

Line ~288-296:

```markdown
### No Media Search
```

# WRONG:

Using Unsplash URLs or random images

# RIGHT:

1. Call mediaSearch({ query: "...", count: 3 })
2. Pick best Getty Images URL
3. Use in featuredImage field

```

```

Replace with:

```markdown
### No Media Search
```

# WRONG:

Using Unsplash URLs or random images

# RIGHT:

1. Call media({ slot: "blog/featured", query: "...", count: 3 })
2. Use the returned slot URL in featuredImage field

```

```

Line ~347:

```markdown
1. mediaSearch({ query: "woman morning workout sunrise fitness", count: 3 })
```

Replace with:

```markdown
1. media({ slot: "blog/morning-workout", query: "woman morning workout sunrise fitness", count: 3 })
```

**Step 2: Commit**

```bash
git add agents/src/skills/blog-writing/skill.md && git commit -m "docs: update blog-writing skill to use media tool"
```

---

## Task 12: Update Media Skill Fallback Section

**Files:**

- Modify: `agents/src/skills/media/skill.md`

**Step 1: Update fallback strategy section**

Find lines ~196-203:

```markdown
## Fallback Strategy

If MCP servers are unavailable, fall back to existing tools:

1. **For image generation**: Use `mediaSearch` with `mediaType: 'generate'`
2. **For image editing**: Use `imageEditor` tool
3. **For video search**: Use `mediaSearch` with `mediaType: 'video'`
```

Replace with:

```markdown
## Fallback Strategy

If MCP servers are unavailable, fall back to existing tools:

1. **For image generation**: Use `media` tool (stock photos as alternative)
2. **For image editing**: Use `imageEditor` tool
3. **For video search**: Use `media` tool with `mediaType: 'video'`
```

**Step 2: Commit**

```bash
git add agents/src/skills/media/skill.md && git commit -m "docs: update media skill fallback to use media tool"
```

---

## Task 13: Run Full Test Suite

**Files:** None (verification only)

**Step 1: Run agents unit tests**

Run: `pnpm --filter @airo/agents test:unit`
Expected: All tests pass

**Step 2: Run app typecheck**

Run: `pnpm --filter website typecheck`
Expected: No errors

**Step 3: Run agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`
Expected: No errors

**Step 4: Run full lint**

Run: `pnpm lint`
Expected: No errors (or pre-existing errors only)

---

## Task 14: Final Commit and Summary

**Step 1: Check git status**

Run: `git status`
Expected: Clean working tree (all changes committed)

**Step 2: View commit history**

Run: `git log --oneline -15`
Expected: See all commits from this implementation

**Step 3: Summary**

Files deleted:

- `agents/src/tools/media-search-tool.ts` (641 lines)
- `agents/src/tools/ai-lib-tools/media-tools.ts` (119 lines)
- `app/src/app/develop/components/tool-renderers/MediaSearchToolRenderer.tsx` (~150 lines)

Files modified:

- `agents/src/services/features.ts`
- `agents/src/agents/develop-agent.ts`
- `agents/src/agents/marketing-agent.ts`
- `agents/src/agents/commerce-agent.ts`
- `agents/src/tools/ai-lib-tools/index.ts`
- `agents/src/agents/__tests__/marketing-agent.test.ts`
- `app/src/app/develop/components/tool-renderers/index.ts`
- `app/src/utils/toolNameMapping.ts`
- `agents/src/skills/blog-writing/skill.md`
- `agents/src/skills/media/skill.md`

Total: ~910 lines removed, ~20 lines modified
