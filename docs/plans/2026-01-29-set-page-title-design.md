# Set Page Title Design

## Problem

When new apps are created, the `index.html` title remains "App Template" instead of being updated to the actual project name. This looks unpolished in the browser tab.

## Solution

Extend the `setProjectName` tool to also update the `<title>` tag in `index.html` when setting the project name.

## Why This Approach

**Option 1 (Chosen): Extend setProjectName tool**

- Runs early in the build process (initial agent, before develop agent)
- Reliable - won't get skipped
- Zero extra token cost
- Simple search/replace implementation
- Handles rename case too

**Option 2 (Rejected): Add build step in prompt**

- Build steps at the end are first to get cut if agent runs long
- Costs tokens for something that can be done deterministically
- Adds complexity to the prompt

## Implementation

### File to Change

`agents/src/tools/ai-lib-tools/set-project-name.ts`

### Logic

After successful database update, add:

```typescript
import { readFile, writeFile } from "fs/promises";
import path from "path";

// ... after successful database update ...

if (existingApp.path) {
  try {
    const indexPath = path.join(existingApp.path, "index.html");
    const content = await readFile(indexPath, "utf-8");
    const defaultTitle = "<title>App Template</title>";

    if (content.includes(defaultTitle)) {
      const updated = content.replace(
        defaultTitle,
        `<title>${input.name}</title>`,
      );
      await writeFile(indexPath, updated, "utf-8");
      logger.info("set-project-name.title-updated", {
        appId,
        title: input.name,
      });
    } else {
      logger.info("set-project-name.title-skipped", {
        appId,
        reason: "already-customized",
      });
    }
  } catch (err) {
    logger.warn("set-project-name.title-update-failed", {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

### Behavior

- Only replaces exact string `<title>App Template</title>`
- If title has been customized, leaves it alone
- Silent on failure (log warning but don't fail the tool)

### Error Handling

| Scenario                   | Behavior                              |
| -------------------------- | ------------------------------------- |
| `index.html` doesn't exist | Log warning, continue (tool succeeds) |
| File read/write fails      | Log warning, continue (tool succeeds) |
| Title already customized   | No-op (exact match required)          |
| App path is null/undefined | Skip title update                     |

### Testing

- Unit test: mock fs operations, verify correct replacement
- Integration test: create app, call tool, verify index.html updated

## No Changes Needed

- Prompts
- Schemas
- Other tools
- Frontend
