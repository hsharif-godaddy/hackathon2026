# Agent Evals

This directory holds evaluations that gate on the quality of agent-generated
output. Evals run alongside normal unit tests so regressions are caught in CI.

## Contents

- `seo-generation.spec.ts` - static, unit-level eval. Loads the DevelopAgent
  prompt fragments (`develop/backend.md`, `develop/frontend.md`,
  `develop/seo.md`, `template-descriptions/v8.md`) and asserts the SEO
  guidance added as part of the SSR + SEO foundation work is present
  (react-helmet, title/description meta, JSON-LD, Open Graph, canonical,
  sitemap, seo-routes registry, `src/server/entry.ts` inline handler
  registration). If a future prompt edit strips any of these, this test
  fails before the change lands.

- `rebuild-design-direction.spec.ts` - static prompt/tool contract in CI; live
  Initial Agent inference over `rebuild-design-direction-matrix.ts` when
  `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is set.

## Planned

A full LLM-driven eval is planned: bootstrap a real DevelopAgent, have it
generate an app from the v8 template, build it, fetch the rendered HTML, and
assert the SEO surface matches expectations (title populated, JSON-LD parses,
sitemap reachable, canonical correct). That eval is not yet implemented.

When it lands it should be opt-in (for example gated behind an env flag or a
separate `test:eval` script) so that normal `pnpm test:unit` runs do not
require provider API keys or network access.

## Contributing

When adding new template-level SEO requirements to the agent prompts, update
the corresponding unit eval here so the new requirement is enforced by CI.
