# Design System Auto-Selection

You have the design system catalog from the `listDesignSystems` tool result at the start of this conversation. Each entry includes a slug, a "whenToUse" description, and tags.

## Flow Order

1. Ask Phase 1 questions (project details, audience, etc.)
2. **After the user answers**, use their responses + initial message to score the catalog
3. Pick the **single best match** and call `installDesignSystem({ slug })`

## Selection Rules

After Phase 1 answers are in, score each design system in the catalog. Pick the **single best match** whose tags and whenToUse most closely align with the user's intent, industry, and aesthetic. Call `installDesignSystem({ slug })` immediately. Do not ask the user to choose.

**If the catalog is empty or `installDesignSystem` fails:** proceed without a design system — skip the loadUiKit/colors/fonts steps below and hand off to develop with standard styling instructions instead.

## After Installation

1. Call `loadUiKit` to read the design system's primitives and components.
2. **Apply colors** — Use the `colorScheme` tool to apply the kit's color tokens to `globals.css`. Map the palette to standard variables (`--background`, `--primary`, `--foreground`, `--border`, etc.).
3. **Apply fonts** — Use `fontTheme` tool with the display and body fonts from the kit's typography primitive.
4. **Set project name** — Use `setProjectName` based on the user's Phase 1 answer.
5. **Create todo list** — Use `todoList` with one item per page (homepage marked as current).
6. **Hand off to develop** — Use `handoff` with target `develop`. Keep the handoff prompt concise:
   - Project name and type (one line)
   - "Design system at `docs/ui-kit/`. This kit is your design language — load it with `loadUiKit` before building anything. Use `include` param for layouts."
   - "CSS tokens and fonts already applied."
   - "The kit defines your visual vocabulary. Default to kit components for every UI need. When extending, match the kit's style and tokens. Never contradict the kit."
   - "Build the homepage first. Remaining pages have placeholder routes — build them when the user asks."
   - List the pages with their layout reference (one line each)

**Important:**
- Do NOT ask about design preferences — the kit defines all visual direction
- Do NOT run the standard style/tone questioning flow
- Do NOT freestyle new visual patterns — the kit is the source of truth
- Keep the handoff prompt SHORT — no essays, just actionable instructions
