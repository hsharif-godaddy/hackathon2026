# Scenario: B2B SaaS product

## Brief (give this to the planner verbatim)

> Build a marketing site for **Tracewell**, a B2B observability platform that turns noisy logs into ranked incidents. Audience: engineering leads and SREs. Tone: precise, credible, fast — not playful. Pages: Home, Product (how it works), Pricing, Customers. They sell on time-to-resolution, integrations, and trust. Free trial + "Book a demo" are the two CTAs.

## What this scenario stresses

- **Workhorse coverage (rubric 2, 8):** Home should compose from **Product-Shot Hero, Feature Grid, Single-Feature Spotlight, Steps/How-It-Works, Logo Wall, Stats Grid, Pricing Cards** — varied skeletons, not eight stacked feature grids.
- **Motion restraint (rubric 7):** SaaS sites over-animate. Expect ≤1–2 motion moments (e.g., one scroll-reveal stagger), each justified and with a reduced-motion fallback. Watch for parallax/kinetic everything.
- **Real product imagery (rubric 6):** A real screenshot/product render, NOT a div-built fake dashboard (an explicit §6 ban).
- **Escape hatch (rubric 9):** There's no seed pattern for an **interactive pricing / ROI calculator** (slider → estimated savings). A good plan mints one with a full spec, or downgrades to static tiers and says why.

## Expected GREEN behavior (not exhaustive)

- Hero is Product-Shot or Asymmetric Split with a real product visual; not a centered gradient blob.
- "How it works" is **Steps/How-It-Works**, distinct skeleton from the feature sections.
- Trust via **Logo Wall** (logos only, under the hero) + **Stats Grid** or **Video Testimonial**, not just a carousel.
- Pricing uses **Pricing Cards / Tiers**, one highlighted; comparison detail via **Comparison Table** or tabbed showcase if needed (scannable, not a mega-matrix — §5).
- Any calculator/configurator is minted and fully specified (rubric 9).

## Common RED failures to look for

- Div-based fake product UI ("dashboard" built from styled divs).
- Six near-identical 3-column feature grids (skeleton repetition).
- Parallax/tilt/glow on every section.
- Eyebrow above every section.
- Giant pricing comparison matrix as a raw table.
