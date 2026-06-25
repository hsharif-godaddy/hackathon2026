# Scenario: SMB service business

## Brief (give this to the planner verbatim)

> Build a marketing site for **Cedar & Co. Grooming**, a two-chair barbershop in Bend, Oregon. Owner-operated, walk-ins welcome but booking encouraged. Vibe: warm, masculine, no-nonsense craft — not a flashy startup. Pages: Home, Services & Pricing, Our Barbers, Book/Visit. They want people to see the price list, see who's cutting, and get directions or book. No real booking backend yet (placeholder links).

## What this scenario stresses

- **Audience fit (rubric 8):** This is the failure mode the skill exists to fix. A baseline planner tends to produce a SaaS-shaped landing page (gradient hero, feature grid of "Why choose us", animated stats, testimonial carousel). The skill should instead reach for **Hours & Location, Menu/Services List, Team/Staff Grid, Ratings/Reviews, Contact/Booking Form** and a **Centered Classic or Full-Bleed Image hero**.
- **Restraint (rubric 7):** A barbershop site should have ~0–1 motion moments. Watch for gratuitous animation.
- **Escape hatch (rubric 9):** There's no seed pattern for a **per-barber weekly availability / shift schedule**. A good plan mints something like a "Weekly Availability Grid" with a full spec — or consciously decides a static hours block suffices and says so.

## Expected GREEN behavior (not exhaustive)

- Home hero is photography-led (Full-Bleed Image or Asymmetric Split), not a centered gradient.
- Services & Pricing uses a **Menu/Services List** or **Pricing Cards**, not a 20-row `border-b` table.
- "Our Barbers" uses a **Team/Staff Grid**.
- Book/Visit combines **Hours & Location + Map Embed + Contact/Booking Form**.
- Distinct skeletons across Home's sections (rubric 2); ≤1 eyebrow per 3 sections (rubric 3).
- If availability is shown, it's a minted, fully-specified pattern (rubric 9).

## Common RED failures to look for

- Centered hero with a generic tagline + two buttons.
- "Features" grid of vague benefit cards instead of real services/prices.
- Animated stat counters ("500+ happy clients").
- No hours/location/map as first-class sections (buried in footer only).
- Testimonial carousel as the only social proof, no real ratings block.
