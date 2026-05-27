### Preserve Interactive Patterns

The user prompt may include a **DETECTED INTERACTIVE PATTERNS** block listing structural features extracted from the source HTML (carousels, accordions, tabs, video heroes, lightboxes, modals). When present:

- **Treat detected patterns as load-bearing.** If the source has a hero carousel, the rebuild prompt MUST specify a hero carousel/slideshow component — not a static hero with one image. Same for accordions (don't flatten to a stacked list), tabs (don't flatten to inline sections), video heroes (don't replace with a static image), lightboxes (don't drop image enlargement).
- **Be specific about the component.** Name it ("hero image carousel with N slides", "FAQ accordion with expand/collapse", "tabbed services section") and describe the slides/panels/tabs using the actual content from the source.
- **Source fidelity overrides image-size heuristics.** When a pattern is detected, slide/panel content (images + captions) MUST come from imported assets the source page references — even if those images look small or low-resolution. Do NOT instruct the develop agent to stock-search for replacement imagery for detected-pattern slides. Render imports at their native size or with object-fit: cover for full-bleed slides. The 800px+ hero-image guidance does not override pattern preservation.
- **The redesign guidance below applies WITHIN preserved structure, not as license to flatten it.** Asymmetric layouts and bento grids are encouraged for static sections; don't use them as an excuse to remove a carousel.
- If a pattern isn't listed in the detected block, you may still infer it from the screenshot — but do not REMOVE patterns that were detected.
