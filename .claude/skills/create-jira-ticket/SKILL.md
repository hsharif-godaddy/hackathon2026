---
name: create-jira-ticket
description: "Create Jira tickets in the AIROBUILD project for any AAB squad/topic. Use when user asks to create, draft, or file a Jira ticket. Always labels with `aab` + a topic tag (aab-editing, aab-ux, aab-paywall, etc.). Trigger: /create-jira-ticket"
---

# create-jira-ticket

Create Jira tickets in the **AIROBUILD** project (Airo AI Builder), labeled with `aab` plus exactly one squad/topic tag.

## When to invoke

User asks to "create a Jira ticket", "file a ticket", "draft a ticket" for any AAB work.

## Auth

Uses the Atlassian remote MCP server. Every tool call below assumes `mcp__atlassian-jira__*` tools are available in this session.

**If the `mcp__atlassian-jira__*` tools aren't listed in your available tools, the MCP server isn't installed.** Stop and ask the user to install it before doing anything else — don't try to work around it with `gh`, `curl`, the web UI, or by drafting tickets without filing them. Suggested install command (user runs this themselves; OAuth opens in a browser on first use):

```
claude mcp add --transport sse atlassian-jira https://mcp.atlassian.com/v1/sse
```

After install, the user must restart Claude Code so the new tools register. Once `mcp__atlassian-jira__atlassianUserInfo` returns a valid user, proceed.

If the tools *are* available but return auth errors (401/403), the MCP server is configured but the OAuth session expired — flag to the user and ask them to re-authenticate; don't try to work around it.

**`cloudId` is `godaddy-corp.atlassian.net`** (the site hostname; the MCP accepts hostname or UUID). Every MCP call below requires this `cloudId` argument; it is omitted from the snippets in this file for brevity but must be passed at runtime.

## Defaults

| Field | Value |
|---|---|
| Project | `AIROBUILD` |
| Type | `Task` (override only if user explicitly says Story/Bug/Epic) |
| Labels | always `aab` + exactly one topic tag (see below) |
| Assignee | unassigned (omit) |
| Parent | search-based proposal (see process step 3) |
| Sprint | none — board 24355 is kanban, no sprints |

## Topic tags

Every ticket gets the `aab` label PLUS exactly one of these topic tags. Pick the best fit from the user's description; if unclear, ask.

| Tag | Squad / topic |
|---|---|
| `airo-aesthetics` | Aesthetics — visual and functional quality of sites and projects |
| `airo-bug` | Bugs |
| `airo-build` | Build process — skills and agents |
| `airo-controlplane` | Control Plane (apps hosting) |
| `airo-editing` | Editing — inline editing experience (Hover Bar, Lexical, RTE, source-mapper, dev-tools) |
| `airo-growth` | Growth |
| `airo-manage` | Manage |
| `airo-paywall` | Paywall |
| `airo-refinement` | Refinement |
| `airo-switcher` | Switcher — customer wanting to switch over to Airo Builder |
| `airo-ux` | UX — overall UI of Airo Builder |

Don't apply more than one topic tag. If the user describes work spanning multiple squads, ask which squad owns it; that's the topic tag. If they insist on multiple, file separate tickets — one per squad.

## Process

1. **Investigate before drafting.** For non-trivial tickets, explore the relevant code first using the Explore agent or direct grep/read. Reference files via GitHub links (see "Citing files"). Do not draft from memory or vibes — verify against current code.

2. **Pick the topic tag, then confirm with the user.** From the user's request, identify the best-fit tag in the table above. **Always confirm the tag with the user before drafting** — even when the fit feels obvious. Show your pick, why you chose it, and the full list of alternatives so they can redirect easily. Use `AskUserQuestion` with the proposed tag as the first option (labeled "(Recommended)") and the other plausible tags as additional options; if more than 3 alternatives feel plausible, list the top 3 and mention the rest in the question text. Don't proceed to step 3 until the user confirms or picks a different tag. If the request is ambiguous (e.g. "fix the publish flow" could be `aab-controlplane` or `aab-bug`), present the candidates without a recommendation and let the user pick.

3. **Propose a parent epic by searching live.** Search for open AIROBUILD epics carrying the same topic label, then show candidates so the user can pick one, name a different epic key, or file with no parent.

   ```
   mcp__atlassian-jira__searchJiraIssuesUsingJql(
     jql="project = AIROBUILD AND issuetype = Epic AND labels = '<topic>' AND statusCategory != Done ORDER BY updated DESC",
     fields=["summary", "status", "labels"]
   )
   ```

   If that returns nothing, broaden:

   ```
   jql="project = AIROBUILD AND issuetype = Epic AND statusCategory != Done ORDER BY updated DESC"
   ```

   Present candidates as "KEY — Summary (status)". Always include a "no parent" option. Don't assume — let the user choose.

4. **Show the user the ticket text** before calling the MCP. Each ticket creation is a side-effecting action visible to others; preview the rendered description, summary, parent, and labels and let them edit. Show the rendered intent (headings, lists, code, links) — not the raw ADF JSON.

5. **Create with `mcp__atlassian-jira__createJiraIssue`.** Pass description as ADF JSON via `contentFormat: "adf"`. The Jira MCP markdown path advertises only "simplified plain text" and may not preserve task lists, code-block languages, or composed marks — use ADF for these templates.

   ```
   mcp__atlassian-jira__createJiraIssue(
     projectKey="AIROBUILD",
     issueTypeName="Task",
     summary="<area>: <one-line change>",
     description=<ADF doc — see "ADF examples">,
     contentFormat="adf",
     parent="AIROBUILD-NNNN",   // omit if user picked "no parent"
     additional_fields={ "labels": ["aab", "<topic>"] }
   )
   ```

   The tool returns the new issue key — capture it for next steps.

6. **Edit with `mcp__atlassian-jira__editJiraIssue`.** For description rewrites, pass `fields: { description: <ADF doc> }` with `contentFormat: "adf"`. For label changes, `fields: { labels: [...] }` replaces the full list — read current labels first if you only want to add one.

7. **Verify creation.** Use `mcp__atlassian-jira__getJiraIssue` to confirm the labels (`aab` + topic), parent, and description landed. Raw ADF is hard to scan — for layout/rendering checks, open the ticket in the browser.

8. **Multi-ticket batches:** when the user agrees to a plan with N pieces, create N separate tickets. Each ticket should:
   - Reference the parent epic and its position in the sequence ("Increment 2 of 5 under AIROBUILD-NNNN")
   - Document its dependency on prior pieces
   - Have its own scope, acceptance criteria, and risk section
   - Each piece can carry a different topic tag if the work genuinely spans squads

9. **Wire dependencies as Jira links, not just prose.** When tickets have a "X must land before Y" relationship (sequential increments, shared scaffolding), add a Blocks link so the chain is visible on the board. Don't use subtasks (each piece is a real ticket with its own AC) and don't create a sub-epic (the parent epic is the rallying point). Keep tickets as siblings under the epic, linked by `Blocks`.

   **Direction (standard Jira REST):** `outwardIssue` performs the type's *outward verb* on `inwardIssue`. For Blocks (`outward: "blocks"`, `inward: "is blocked by"`) that means **`outwardIssue` is the blocker, `inwardIssue` is the blocked**. So "1697 blocks 1698" → `outwardIssue=AIROBUILD-1697, inwardIssue=AIROBUILD-1698`.

   > Heads-up: the `mcp__atlassian-jira__createIssueLink` tool's own description currently states the *opposite* convention (claiming `inwardIssue` is the blocker). That description is misleading — the underlying REST API and Jira UI follow the convention above. Verified against existing AIROBUILD Blocks links: e.g. `AIROBUILD-1697`'s issuelinks contain `inwardIssue: AIROBUILD-1698`, which renders in the UI as "1697 blocks 1698" — confirming the field a ticket sees in its own `issuelinks` payload is *the other side's* role. If you ever doubt this, fetch a known existing link with `getJiraIssue` and inspect.

   ```
   mcp__atlassian-jira__createIssueLink(
     inwardIssue="AIROBUILD-1698",
     outwardIssue="AIROBUILD-1697",
     type="Blocks"
   )
   # Result: 1697 (outward) blocks 1698 (inward)
   ```

   Use `mcp__atlassian-jira__getIssueLinkTypes` if unsure of the link type name (returns each type's `inward` / `outward` verbs).

## Citing files

**Don't include line numbers in ticket descriptions.** This codebase changes fast — line ranges go stale within days. Link to the file on GitHub instead:

```
https://github.com/gdcorp-partners/airo-app-builder/blob/main/<path>
```

Use the basename (e.g. `element-detection.ts`) as the visible link text, not the full path — the path is in the URL, and short link text reads better in lists. If the basename is ambiguous (e.g. multiple `index.ts`), disambiguate (`source-mapper/src/index.ts`).

If you genuinely need to point at a specific block (e.g. a 50-line function in a 2000-line file), prefer GitHub permalinks pinned to a commit SHA over `main` + line numbers — the SHA is stable, `main` drifts. But default to no line numbers.

URL-encode `[` and `]` in paths (Next.js dynamic segments): `[market]` → `%5Bmarket%5D`. Otherwise some Atlassian renderers truncate the link.

## ADF (Atlassian Document Format)

ADF is JSON. Top-level shape: `{ "version": 1, "type": "doc", "content": [...blocks...] }`. The MCP `createJiraIssue` and `editJiraIssue` tools accept this object (stringified) when `contentFormat: "adf"` is set.

### Block nodes

| Node | Shape |
|---|---|
| Heading | `{ "type": "heading", "attrs": { "level": 2 }, "content": [text] }` |
| Paragraph | `{ "type": "paragraph", "content": [text] }` |
| Bullet list | `{ "type": "bulletList", "content": [listItem...] }` |
| Numbered list | `{ "type": "orderedList", "content": [listItem...] }` |
| List item | `{ "type": "listItem", "content": [{ "type": "paragraph", "content": [text] }] }` |
| Task list | `{ "type": "taskList", "attrs": { "localId": "..." }, "content": [taskItem...] }` |
| Task item | `{ "type": "taskItem", "attrs": { "localId": "...", "state": "TODO" }, "content": [text] }` |
| Code block | `{ "type": "codeBlock", "attrs": { "language": "ts" }, "content": [{ "type": "text", "text": "..." }] }` |
| Blockquote | `{ "type": "blockquote", "content": [paragraph] }` |
| Rule | `{ "type": "rule" }` |

### Inline marks

Inline text node: `{ "type": "text", "text": "..." }` with optional `marks`:

| Mark | Shape |
|---|---|
| Bold | `{ "type": "strong" }` |
| Italic | `{ "type": "em" }` |
| Inline code | `{ "type": "code" }` |
| Link | `{ "type": "link", "attrs": { "href": "https://..." } }` |
| Strike | `{ "type": "strike" }` |

Marks compose. A linked filename rendered as inline code:

```json
{
  "type": "text",
  "text": "Header.tsx",
  "marks": [
    { "type": "code" },
    { "type": "link", "attrs": { "href": "https://github.com/gdcorp-partners/airo-app-builder/blob/main/app/src/app/%5Bmarket%5D/develop/components/layout/Header.tsx" } }
  ]
}
```

`localId` values just need to be unique within the doc — `"ac-1"`, `"ac-2"`, `"scope-1"` is fine.

### Implementation-ticket example

A complete ADF doc you can copy and adapt. Pass this as `description` (stringified) with `contentFormat: "adf"`:

```json
{
  "version": 1,
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Goal" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "One-sentence statement of what changes." }] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Background" }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "Context. Reference adjacent work via " },
      { "type": "text", "text": "AIROBUILD-NNNN", "marks": [{ "type": "code" }] },
      { "type": "text", "text": " and link relevant files." }
    ] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Scope" }] },
    { "type": "orderedList", "content": [
      { "type": "listItem", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "First step." }] }
      ] },
      { "type": "listItem", "content": [
        { "type": "paragraph", "content": [
          { "type": "text", "text": "Second step touching " },
          { "type": "text", "text": "someIdentifier", "marks": [{ "type": "code" }] },
          { "type": "text", "text": "." }
        ] }
      ] }
    ] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Out of scope" }] },
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [
        { "type": "paragraph", "content": [{ "type": "text", "text": "Explicit non-goal." }] }
      ] }
    ] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Acceptance criteria" }] },
    { "type": "taskList", "attrs": { "localId": "ac" }, "content": [
      { "type": "taskItem", "attrs": { "localId": "ac-1", "state": "TODO" }, "content": [{ "type": "text", "text": "Item one" }] },
      { "type": "taskItem", "attrs": { "localId": "ac-2", "state": "TODO" }, "content": [{ "type": "text", "text": "Item two" }] }
    ] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Risk" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "Low / Medium / High — and the mitigation." }] },

    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Relevant files" }] },
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [
        { "type": "paragraph", "content": [
          { "type": "text", "text": "Header.tsx", "marks": [
            { "type": "link", "attrs": { "href": "https://github.com/gdcorp-partners/airo-app-builder/blob/main/app/src/app/%5Bmarket%5D/develop/components/layout/Header.tsx" } }
          ] }
        ] }
      ] }
    ] }
  ]
}
```

### Diagram-inside-a-ticket example

ASCII / box-drawing inside an ADF `codeBlock` renders as a styled monospace block:

```json
{
  "type": "codeBlock",
  "attrs": { "language": "text" },
  "content": [
    { "type": "text", "text": "┌──────────┐    ┌─────────────────┐    ┌──────────────┐\n│ HoverBar │───▶│  source-mapper  │───▶│  dev-tools   │\n│  (UI)    │    │ (id ↔ source)   │    │ (TEXT_UPDATE)│\n└──────────┘    └─────────────────┘    └──────────────┘\n" }
  ]
}
```

For diagrams ASCII can't represent cleanly, use mermaid: `attrs: { "language": "mermaid" }`. Source is readable on its own; whether it auto-renders depends on Jira plugins — don't assume.

### Tips

- Inline identifiers (`data-dev-id`, function names, attribute values) get the `code` mark.
- For a code-formatted file link, attach `code` AND `link` marks together.
- Don't put line numbers in either the link URL or the visible text. Link to `main`.
- Block nodes already have separation; don't add empty paragraphs between them.
- If you find yourself wanting Markdown (`**bold**`, `## heading`), stop — the ADF path renders it literally. Use ADF nodes.

## Visual diagrams

For architectural tickets — anything describing a flow, a contract between components, a state machine, or "before vs after" — a small inline diagram is often clearer than three paragraphs of prose. Default mechanism: ASCII / box-drawing inside an ADF `codeBlock` (see example above).

**When to include one:**
- Multi-component flow
- Before/after structural changes (a refactor that moves boundaries)
- A protocol or sequence with ≥3 actors
- An invariant chart (state machine, condition table)

**When NOT:**
- A plain list of files (use `bulletList` instead)
- A pure code change (the code itself is the diagram)
- Anything you can express in 1–2 sentences

**Conventions:**
- Use box-drawing characters (`┌ ─ ┐ │ └ ┘ ├ ┤ ▼ ▲ ◄ ►`) over `+--+` ASCII when possible — same width, easier to read.
- Keep widths under ~80 chars so the diagram stays readable in narrow viewports.
- Label arrows with the data shape that crosses each edge, not just the verb.

**Image attachments:** the Atlassian MCP doesn't expose attachment-add. If a diagram genuinely needs to be a PNG/SVG, that's a manual step outside this skill — flag it to the user rather than trying to automate.

## Description templates

**Implementation tickets** — `content` array follows this structure:

1. `heading` "Goal" → `paragraph` (one sentence).
2. `heading` "Background" → 2–4 `paragraph`s. Reference parent epic and adjacent work. Link relevant files via GitHub URLs.
3. `heading` "Scope" → `orderedList` of work items.
4. `heading` "Out of scope" → `bulletList` of explicit non-goals.
5. `heading` "Acceptance criteria" → `taskList` with `taskItem` per criterion.
6. `heading` "Risk" → `paragraph` (Low/Medium/High + mitigations).
7. `heading` "Relevant files" → `bulletList` of file links (basename as link text).

**Bug tickets** (`aab-bug`) — adjust to:

1. `heading` "Summary" → one-sentence user-visible problem.
2. `heading` "Steps to reproduce" → `orderedList`.
3. `heading` "Expected" → `paragraph`.
4. `heading` "Actual" → `paragraph`.
5. `heading` "Root cause (if known)" → `paragraph`. Be honest if unknown.
6. `heading` "Acceptance criteria" → `taskList`.
7. `heading` "Relevant files" → `bulletList` of file links.

**Spike tickets** (design / investigation only):

1. `heading` "Problem" → `paragraph`s.
2. `heading` "Proposal" (if any) → `paragraph`s. Be honest if there isn't one.
3. `heading` "Scope of this spike" → `paragraph` + `orderedList`.
4. `heading` "Acceptance criteria" → `taskList`. Defaults: design doc merged, decision documented, no code changes.
5. `heading` "Relevant files" → `bulletList` of file links.

## Conventions

- **No emojis** in descriptions. AAB CLAUDE.md prohibits them.
- **Link files via GitHub URLs**, basename as link text, no line numbers (codebase changes too fast).
- **Write for a mid-level engineer new to the codebase.** Explain the problem in plain terms before diving into specifics. State what's broken from a user's perspective first, then the technical why. Define jargon on first use (or link to the source). Keep it concise — clarity, not verbosity.
- **Honest risk assessments.** If a ticket is medium-risk, say so — don't soft-pedal.
- **Open questions inline.** If a decision is unresolved, put it in an "Open question" section in the ticket rather than leaving it ambiguous.
- **Semantic summaries** lead with the area: "Builder header:", "Inline editing:", "Paywall:", "Publish:", etc. Helps when scanning the board.
- **PR titles for these tickets:** `AIROBUILD-NNNN <Description>` — ticket key, single space, sentence-case description. No semantic prefix on the title. Commits inside the PR keep semantic prefixes (`feat:` / `fix:` / etc.).

## Useful MCP calls

For parent-epic search and `getIssueLinkTypes`, see steps 3 and 9 above. Other calls you may want during a ticket workflow:

```
# Confirm ticket landed and inspect description
mcp__atlassian-jira__getJiraIssue(
  issueIdOrKey="AIROBUILD-NNNN",
  responseContentFormat="adf"
)

# List open work for a topic
mcp__atlassian-jira__searchJiraIssuesUsingJql(
  jql="labels = aab AND labels = '<topic>' AND status != Done",
  fields=["summary", "status", "parent", "labels"]
)

# Status transition
mcp__atlassian-jira__getTransitionsForJiraIssue(issueIdOrKey="AIROBUILD-NNNN")
mcp__atlassian-jira__transitionJiraIssue(
  issueIdOrKey="AIROBUILD-NNNN",
  transition={ "id": "<id from getTransitions>" }
)

# Add a comment
mcp__atlassian-jira__addCommentToJiraIssue(
  issueIdOrKey="AIROBUILD-NNNN",
  commentBody=<ADF doc or markdown string>,
  contentFormat="adf"
)
```
