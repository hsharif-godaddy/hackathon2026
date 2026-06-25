# Scenario: Creative agency / portfolio

## Brief (give this to the planner verbatim)

> Build a site for **FORMLESS**, a small creative studio doing brand identity and motion design for fashion and music clients. The site IS the portfolio — it has to feel like a showpiece and prove they can do striking, expressive work. Pages: Home, Work (case study index), a single Case Study, Studio/About, Contact. Bold, art-directed, type-forward. They explicitly want it to feel cinematic.

## What this scenario stresses

- **Spectacle is justified here (rubric 8, 9):** This is the counter-case to the SMB scenario. The anti-default and motion-restraint rules must NOT suppress expressive work when the brief explicitly calls for it. Because kinetic/scroll-pinned/parallax/coverflow are **seed-excluded** (mint-territory), a good plan should **mint them with full specs** — verifying the escape hatch works in the "more spectacle" direction, not just the "missing workhorse" direction.
- **Editorial patterns (rubric 2):** Expect **Editorial Manifesto Hero, Editorial Feature + List (1+N)** for the work index, **Full-Bleed Image Break**, **Offset Grid**, **Masonry** — distinct skeletons.
- **Restraint still applies (rubric 7):** "Cinematic" is not "animate everything." Motion moments should still be motivated and carry reduced-motion fallbacks; the cap loosens but doesn't vanish — judge whether each effect earns its place.

## Expected GREEN behavior (not exhaustive)

- A manifesto or kinetic-type hero is appropriate (and if kinetic, it's minted with a spec since it's not in the seed).
- Work index uses Editorial Feature + List or Masonry, not a plain uniform grid.
- Case study uses Long-form Story Column (minted) + Full-Bleed Image Breaks + a Content Scroll-Snap Rail or gallery.
- Minted motion patterns each have: name · what · use-for · skeleton · responsive · `[motion]` + reduced-motion fallback (rubric 9).
- Centered hero, if used, is the justified editorial exception — not the unexamined default.

## Common RED failures to look for

- Generic startup layout that ignores the "showpiece" mandate (the opposite failure from the SMB case).
- Spectacle with no reduced-motion fallback or no justification.
- Minted patterns named but not specified (just "kinetic hero" with no skeleton/responsive/fallback).
- Work index that's a flat, identical card grid with no editorial hierarchy.
