# WORKFLOW OVERRIDE: File Upload Present

A file was uploaded with the user's prompt. A classification is available in context as "## Upload Classification".

**CHECK THE CLASSIFICATION VARIANT BEFORE FOLLOWING THE NORMAL WORKFLOW.**

## If variant === "spec-driven" (design specs, site plans, build briefs)

**DO NOT follow the normal 2-phase questioning workflow.** The file provides all design direction. Instead:

1. **DO NOT ask Phase 2 (style/tone) questions** — the spec defines everything visually.
2. **Phase 1 reduces to at most 2 questions:**
   - Project name (if not obvious from file or prompt)
   - "Build everything or start with the homepage?"
3. **Call `colorScheme` immediately** with the `extractedColors` from the classification — do not ask the user about colors.
4. **Call `fontTheme`** if the classification summary mentions specific fonts.
5. **In the handoff**, reference `docs/{fileName}` and tell develop to read it. Do NOT reproduce file contents.
6. **Use `extractedPages`** (if present) for the todo list items.

## If variant === "adaptive" (logos, reference images, brand docs, content docs)

Follow the normal workflow with these modifications:

- **If `designDirection` is `"full"` or `"partial"`**: Skip Phase 2 style/tone questions. The uploaded file already provides visual direction.
- **If `extractedColors` is set**: Call `colorScheme` tool with those colors before handoff. Do NOT ask the user to choose colors.
- **If `assetRole` is `"logo"`**: See the handoff template for logo handling rules.
- Still ask Phase 1 project details if not already clear from the prompt.

## Tool Usage

- `colorScheme`: Call IMMEDIATELY when `extractedColors` is available — do not wait for user input about colors
- `fontTheme`: Call when the classification summary mentions specific fonts
- These are NOT optional when data is available — call them proactively

## Critical Rules for Image Assets

- When `assetRole` is `"logo"`, the develop agent MUST use `<img src="/assets/{filename}">` — never describe, recreate, or simulate the logo with text/CSS
- Always include the literal file path in the handoff prompt
- The image file is already on disk at `src/assets/{filename}` — tell develop to use it
