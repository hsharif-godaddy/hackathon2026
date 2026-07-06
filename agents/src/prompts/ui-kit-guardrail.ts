/**
 * Single source of truth for the UI-kit copy guardrail.
 *
 * Injected at every context vector that exposes UI-kit example markup to the
 * agent (per-turn anchor, the `loadUiKit` tool output, and the uploaded-kit
 * renderer). It must stay byte-identical across those sites, so all of them
 * import this constant rather than hand-duplicating the sentence. List contexts
 * (e.g. the per-turn anchor bullet) prepend their own `- ` marker.
 *
 * Pairs with Mosaic's scrub-on-publish (mosaic#174): scrubbing neutralizes
 * catalog kits at the source, while this guardrail stops the agent parroting the
 * remaining generic placeholder copy and is the ONLY copy guardrail for
 * user-uploaded kits, which never pass through Mosaic's publish pipeline.
 */
export const UI_KIT_COPY_GUARDRAIL =
  'The kit\'s component and primitive examples illustrate structure, style, and tokens only. Treat their business and marketing copy — headlines, taglines, testimonials, service names, and business names — as placeholder; never reuse it. Always write the customer\'s own content. Conventional UI labels (e.g. "Submit", "Email", "Learn more", nav items, aria-labels) may follow the kit\'s patterns.'

/**
 * Kit-scoped color & contrast guardrail (AIROBUILD-3143 / 2976). Injected into
 * the per-turn kit anchor (context-manager) — NOT core.md — so it applies only
 * to design-kit builds. The named phrases here are pinned by
 * `src/evals/contrast-guidance.spec.ts`; a reword must revisit that eval.
 */
export const UI_KIT_COLOR_CONTRAST_GUARDRAIL = [
  'Color & contrast — the kit palette is AA-safe, but how you *place* text decides the final ratio:',
  '- Carry every text color with the semantic foreground tokens: `text-foreground` (primary), `text-secondary-foreground` (secondary), and `text-muted-foreground` only for low-emphasis text on its matching muted/card surface. Never put a raw Tailwind shade (`text-gray-700`), hardcoded hex, or an opacity modifier on text (`text-foreground/50`) in markup or `style={}` — they bypass the kit and have no guaranteed contrast. Set emphasis by switching tokens at full opacity instead.',
  '- On any light, brand-colored, or gradient surface, reach for the higher-contrast token; when unsure which surface a token pairs with, pick the higher-contrast one, and follow the kit\'s documented pairing if it has one.',
  '- `border`, divider, and ring tokens are surface/line colors — keep them off text, and keep low-emphasis labels at the kit\'s small-label size rather than shrinking and dimming them.',
  '- These are defaults, not a cage: when the customer explicitly asks for a specific color, honor it — apply it through a kit token / CSS variable (the color-scheme `apply` path) so the palette keeps its contrast pairing, rather than hardcoding hex.',
  '- You have no contrast-measuring tool, so design from these high-contrast defaults and don\'t claim text "meets WCAG AA".',
].join('\n')
