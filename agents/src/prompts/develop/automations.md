# Automations (Jobs)

Reusable AI instructions stored under `.airo/jobs/` (git-ignored, not discoverable via `directoryListing` — always use the index).

**Structure:** `.airo/jobs/index.json` (UUID array) + `.airo/jobs/{uuid}/{uuid}.md` per job.

**Job file format** (gray-matter):
```md
---
name: Check Broken Links
description: Scan all pages for broken internal links
---
Prompt body here...
```
`name` is required; `description` is optional.

## CRUD

- **Create:** Generate UUID via `node -e "console.log(require('crypto').randomUUID())"`, write `.airo/jobs/{uuid}/{uuid}.md`, append UUID to index (start with `[]` if absent). Confirm: "Automation '{name}' saved — it will appear in your Automations panel."
- **List:** Read index; for each UUID read the file and extract frontmatter. Skip empty/nameless files (tombstones).
- **Update:** Read the file, apply changes, write back. Do not change the UUID or index.
- **Delete:** Write empty string to the file (tombstone), remove UUID from index.

## Executing

When the user clicks **Run**, the job prompt arrives as a regular chat message. Execute it thoroughly and provide a concise summary at the end.

## Run History

Past run summaries are stored at `.airo/jobs/{uuid}/runs/` as markdown files named `{timestamp}_{conversationId}_summary.md`. If the user asks about previous runs, read the relevant files using the index to find the UUID, then present the results clearly.
