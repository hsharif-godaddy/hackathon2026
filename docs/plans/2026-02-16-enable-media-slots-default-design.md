# Enable Media Slots by Default & Delete Old Media Search Tool

**Date:** 2026-02-16
**Status:** Approved

## Problem Statement

The codebase has two media tools:

1. `mediaSearch` - Old tool that returns direct URLs from Getty Images
2. `media` (media slots) - New tool that uses semantic slots with manifest-based resolution

Currently, media slots are behind a feature flag (`ENABLE_MEDIA_SLOTS`) that defaults to `false`. This creates:

- Conditional logic in the develop agent
- Two code paths to maintain
- Inconsistent behavior across agents (marketing/commerce still use old tool)

## Goals

1. Make media slots the default and only media tool
2. Remove the feature flag entirely
3. Delete all old `mediaSearch` code
4. Update all agents to use the `media` (slots) tool

## Design

### Files to Delete

| File                                                                        | Lines | Purpose                                 |
| --------------------------------------------------------------------------- | ----- | --------------------------------------- |
| `agents/src/tools/media-search-tool.ts`                                     | 641   | Core implementation of old media search |
| `agents/src/tools/ai-lib-tools/media-tools.ts`                              | 119   | AI-lib wrapper for old tool             |
| `app/src/app/develop/components/tool-renderers/MediaSearchToolRenderer.tsx` | ~150  | Old renderer                            |

**Total:** ~910 lines removed

### Files to Modify

#### Feature Flag Removal

**`agents/src/services/features.ts`**

- Remove `mediaSlots: boolean` from `enabledFeatures` interface
- Remove `mediaSlots: process.env.ENABLE_MEDIA_SLOTS === 'true'` from config

#### Agent Updates

**`agents/src/agents/develop-agent.ts`**

- Remove conditional tool selection
- Always use `media: allAILibTools.media`

**`agents/src/agents/marketing-agent.ts`**

- Change `mediaSearch: allAILibTools.mediaSearch` to `media: allAILibTools.media`

**`agents/src/agents/commerce-agent.ts`**

- Change import from `media-tools.js` to `media-slot.js`
- Change `mediaSearch: mediaSearchAITool` to `media: mediaSlotAITool`

#### Registry Updates

**`agents/src/tools/ai-lib-tools/index.ts`**

- Remove `mediaSearchAITool` export and import
- Remove `mediaSearch` from `allAILibTools` registry
- Remove `mediaSearch` from `toolGroups.media`

**`app/src/app/develop/components/tool-renderers/index.ts`**

- Remove `MediaSearchToolRenderer` import and export
- Remove `mediaSearch` from `toolRendererRegistry`

**`app/src/utils/toolNameMapping.ts`**

- Remove `mediaSearch` case (falls through to auto-format)

#### Test Updates

**`agents/src/agents/__tests__/marketing-agent.test.ts`**

- Change `expect(config.tools).toHaveProperty('mediaSearch')` to `media`
- Update tool count expectation if needed

#### Prompt/Skill Updates

**`agents/src/skills/blog-writing/skill.md`**

- Replace `mediaSearch` references with `media` tool

**`agents/src/skills/media/skill.md`**

- Update fallback section to reference `media` tool

## Backward Compatibility

Existing conversation history that references `mediaSearch` tool calls will:

- Render using `DefaultToolRenderer` (graceful fallback)
- Tool name display falls through to auto-format in `toolNameMapping.ts`

No data migration is needed.

## Testing Plan

1. **Unit Tests:**

   - Run `pnpm --filter @airo/agents test:unit`
   - Verify marketing-agent test expects `media` tool

2. **Integration Tests:**

   - Verify develop agent has `media` tool
   - Verify marketing agent has `media` tool
   - Verify commerce agent has `media` tool

3. **Manual Testing:**
   - Create new conversation, request an image
   - Verify `media` tool is called
   - Verify `MediaSlotToolRenderer` renders correctly

## Out of Scope

- Changes to the `media` slot tool itself
- Changes to `MediaSlotToolRenderer`
- Migration of existing conversation data
