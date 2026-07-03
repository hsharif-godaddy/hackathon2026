---
name: automations
description: Create, update, delete, list, and run reusable AI automation jobs for the user's app
switchboardFlag: automationsEnabled
whenToUse: User wants to create, add, edit, update, delete, remove, list, show, or run automations (also called jobs or saved prompts). Also load when the user asks about automation history, previous runs, what automations exist, or anything related to the Automations panel.
intents:
  - create automation/add automation/new automation/save automation/saved prompt
  - edit automation/update automation/change automation/modify automation/rename automation
  - delete automation/remove automation
  - list automations/show automations/my automations/what automations
  - run history/previous runs/automation results/last run
  - automation/AI automation/reusable automation/automation job
---

# Automations (Jobs)

Reusable AI prompt templates stored as markdown files under `.airo/jobs/` (git-ignored).

## Storage

```
.airo/jobs/
  index.json          ← UUID[] — always read this first, never use directory listing
  {uuid}/{uuid}.md    ← job file (gray-matter)
  {uuid}/runs/        ← run history summaries
```

## File Format

```md
---
name: Check Broken Links
description: Scan all pages for broken internal links
---
Prompt body here...
```

`name` required (max 100 chars) · `description` optional (max 300) · body max 10 000 chars

## CRUD

This skill provides five tools that handle all automation management. Use them instead of
writing files or running terminal commands — UUID generation happens server-side.

**Create**
```
automations__create({ name, description?, body })
```
Returns `{ uuid, name, message }`. Relay the `message` to the user verbatim.

**List**
```
automations__list({})
```
Returns `{ automations: [{ uuid, name, description? }], warnings? }`.
Show name, description, and UUID for each entry. Surface any `warnings` to the user.
If the array is empty tell the user: _"You don't have any saved automations yet. Would you like me to create one?"_

**Update**
```
automations__update({ uuid, name?, description?, body? })
```
Omit any field you are not changing. Relay the returned `message` to the user.

**Delete**
```
automations__delete({ uuid })
```
Relay the returned `message` to the user.

**Find by name** — call `automations__list`, match case-insensitively; if ambiguous show the list and ask.

**Get run history**
```
automations__getHistory({ uuid, limit? })
```
Returns `{ runs: [{ timestamp, status, summary, conversationId? }], total, truncated? }`.
Present runs newest-first. If `runs` is empty tell the user this automation hasn't been run yet.

## Running

When the user clicks Run, the job prompt arrives as a regular chat message. Execute thoroughly and end with a concise summary.

## Run History

Run summaries are stored at `.airo/jobs/{uuid}/runs/` — use `automations__getHistory` to read them.
Do not navigate the filesystem directly for run history.

