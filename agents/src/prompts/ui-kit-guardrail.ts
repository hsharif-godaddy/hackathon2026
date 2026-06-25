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
