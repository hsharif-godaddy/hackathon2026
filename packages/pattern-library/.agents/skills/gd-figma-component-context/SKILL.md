---
name: gd-figma-component-context
description: Enrich GoDaddy Figma components with authoritative context from any connected GoDaddy component library MCP. Use when enriching Figma COMPONENT_SET nodes, writing component descriptions for Dev Mode, connecting Figma to component libraries, documenting design system components, mapping Figma components to code, or setting up component metadata. Works with any MCP that exposes list_codexes, search_components, and get_component (e.g. uxcore2-codex).
license: Proprietary
metadata:
  author: godaddy-platform
  version: "1.0"
  category: design
  platform: figma
---

# gd-figma-component-context

Enrich Figma COMPONENT_SET nodes with authoritative metadata sourced from connected GoDaddy component library MCPs. Improves Dev Mode readability and AI-assisted code generation from Figma.

Works with any MCP that exposes `list_codexes`, `search_components`, and `get_component` tools — not hardcoded to a specific one.

---

## When to Use

- You want to write component descriptions and documentation links to Figma COMPONENT_SET nodes
- You're setting up or refreshing Dev Mode metadata for a GoDaddy design system page
- You need to connect Figma components to their authoritative code documentation
- You're enriching a Figma file so AI agents can generate accurate code from designs
- A GoDaddy component library MCP (e.g. `uxcore2-codex`) is connected and you want to sync it to Figma

---

## Prerequisites

- **Figma MCP** must be connected
- **At least one GoDaddy component library MCP** must be connected and must expose `list_codexes`, `search_components`, and `get_component` (e.g. `uxcore2-codex`)
- **Always load `figma:figma-use`** before calling `use_figma`

---

## Quick Start

Provide a Figma URL (page, frame, section, or component set):

```
/gd-figma-component-context https://www.figma.com/design/...?node-id=6160-3177
```

The search scope is determined by the linked node and the user's prompt. If the URL points to a specific frame or section, only that subtree is searched. If it points to a page, the whole page is searched. COMPONENT_SET nodes are discovered up to two levels of FRAME/SECTION nesting deep (GROUP nodes are not descended into). Matched components are enriched with authoritative docs and documentation links written back to Figma.

---

## Instructions

### Step 1: Parse the URL

Extract `fileKey` and `nodeId`:
- Branch URL: `figma.com/design/:fileKey/branch/:branchKey/...?node-id=:n1-:n2` → use `branchKey` as `fileKey`
- Convert node-id dashes to colons: `6160-3177` → `6160:3177`

The `nodeId` from the URL may point to any node type (page, frame, section, component set, etc.). The linked node — combined with the user's prompt — determines the traversal scope. Do not assume page-level scope; a link to a specific frame means enrich that frame.

### Step 2: Discover available codexes

Call `list_codexes` to enumerate all connected component library MCPs and their available codexes.

Present a summary to orient yourself:
```
MCP: uxcore2-codex  →  codex: uxcore2@2500.0.1  (GoDaddy UXCore2/Antares components)
MCP: other-mcp      →  codex: other@1.0.0        (description...)
```

If no component library MCP is connected at all, inform the user and stop — the skill cannot proceed without one.

### Step 3: Discover COMPONENT_SETs

Load `figma:figma-use`. Resolve the node from the URL and use it directly as the traversal root — do not automatically widen scope to the full page. Walk up to find the containing page only to set the active page context. Traverse up to two levels of FRAME/SECTION nesting from the root. Never use `findAll` — it times out on large pages. GROUP nodes are not descended into.

Use **`scripts/discover-component-sets.js`** as the `use_figma` code for this step, substituting `<nodeId>` with the resolved node ID.

Returns: `{ page, traversalRoot, componentSets[] }` — each entry has `{ id, name, parent, desc, props[] }`.

### Step 4: Match components to a codex

For each COMPONENT_SET, determine which connected codex contains the relevant docs.

**Attempt auto-match first:**
Call `search_components(query: "<node name>")` — if the MCP has multiple codexes, search across all of them. Look for a high-confidence match in the results (matching name, description, or `resource-uri` prefix).

**If a clear match is found:** proceed with that codex. Note which MCP/codex was selected so you can tell the user.

**If ambiguous (multiple codexes match, or match confidence is low):** ask the user before proceeding:

> "I found possible matches in multiple codexes for **[component name]**:
> - `uxcore2@2500.0.1` → `ux-button` (GoDaddy UXCore2/Antares)
> - `other-codex@1.0` → `button` (Other library)
>
> Which should I use? Or skip this component?"

**If no match is found in any connected codex:** ask the user:

> "I couldn't find **[component name]** in any connected component library. Options:
> - Specify a component name to search for
> - Skip this component
> - Skip all unmatched components"

Accumulate user decisions so you only need to ask once per ambiguous group, not once per component.

### Step 5: Fetch docs

For each matched component:

```
get_component(component: "<id or name>", codex: "<codex-name>")
```

The response provides: API props, usage examples, when to use / not to use, content guidelines, accessibility, resource URI. The `resource-uri` from the codex response is the canonical identifier — use it verbatim in the description.

### Step 6: Write enriched descriptions

Batch writes: if >6 nodes, split into multiple `use_figma` calls to avoid timeout.

```js
node.description = `<formatted description>`;
node.documentationLinks = [{ uri: '<docs URL from codex response>' }];
```

Always `return { mutatedNodeIds: [...], count: N }` to confirm.

---

## Description Format

Write on the COMPONENT_SET node. Never on individual COMPONENT variants.

````
# <component name from codex> [— Variant name if this set is one of several]
<one-sentence purpose>. <one-sentence constraint if relevant>.

## Variants
```
prop1    ⭐️ value1 (default) | value2 | value3
prop2    value1 | value2
```
[Note: ⛔️ DESIGN ONLY items have no code equivalent.]

## When to use
✓ <primary use case>
✓ <secondary use case>

## When NOT to use
✗ <anti-pattern> → use <alternative> instead

## Content
<writing/copy guidance — omit if not applicable>

## Accessibility
<a11y note — omit if not applicable>

resource-uri: <resource-uri from codex response>
````

**Formatting rules:**
- `#` for component name, `##` for section headers — Figma renders these as rich text headings in Dev Mode
- Fenced code block for the variants table
- Mark defaults with ⭐️, design-only variants with ⛔️
- `resource-uri` must be copied verbatim from the codex response — never constructed manually
- Do NOT add a `docs:` line in the description — set `documentationLinks` as a separate node property

**For internal sub-components** (`🔒` prefix, `🧩` prefix):
- 1–2 sentences: what it is, what parent component it belongs to
- Still include `resource-uri`
- Skip When to use / When NOT to use

---

## Error Handling

| Error | Solution |
|-------|----------|
| No component library MCP connected | Inform user and stop. The skill requires at least one MCP exposing `list_codexes`, `search_components`, and `get_component`. |
| URL points to a GROUP or other non-traversable node | Return an error and ask the user to provide a link to a page, frame, section, or component set instead. |
| `findAll` or traversal times out | Use shallow traversal only (up to two levels of `FRAME`/`SECTION` nesting). Never call `findAll` on large pages. |
| `use_figma` write times out with >6 nodes | Split into batches of 6 or fewer nodes per `use_figma` call. |
| Component not found in any codex | Ask the user: skip, provide an alternate search term, or skip all unmatched. |
| Ambiguous match across multiple codexes | Ask the user to confirm which codex to use before writing. |

---

## Skip Rules

Automatically skip without asking:
- `_NOT NEEDED/...` — deprecated/archived
- `[⚠️ External]` — externally-sourced, outside the DS

Ask the user before skipping:
- Any COMPONENT_SET where no MCP match was found
- Any COMPONENT_SET where multiple codexes matched with similar confidence

---

## Related Skills

- `uxcore`: UXCore-specific styling patterns (intents, @ux/box, logical properties)
- `brand-guidelines`: GoDaddy Brand Identity Guidelines for creative design
- `accessibility`: Apply WCAG 2.1 Level AA accessibility standards to UI

---

## Resources

- Figma Dev Mode documentation: https://help.figma.com/hc/en-us/articles/15023124644247
- UXCore2/Antares component library: connect via `uxcore2-codex` MCP
