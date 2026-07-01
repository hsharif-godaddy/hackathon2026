# §17 UI Design — Rich, Modern Interfaces

Guide for reading the app's existing design language and producing visually compelling, business-appropriate UI. Instructions are intentionally non-prescriptive — study the theme, understand the business, then make deliberate creative decisions. No two apps should look the same.

---

## Step 1 — Read the theme before touching anything

Read these files first and extract the design language:

- `src/index.css` — CSS variables: color tokens, border radius base, font stacks, shadow definitions
- `tailwind.config.ts` — custom tokens, extended values, anything overriding Tailwind defaults
- `src/App.tsx` and existing pages — what visual patterns are already in use?

Answer these questions from what you read:
- What are the actual color values for primary, background, foreground, muted, border, accent?
- What is the base border radius token — tight, medium, or generous?
- What font families are loaded — is there a display/heading font separate from body?
- Is there motion already in use, or is the UI currently static?
- Where does the current UI feel flat, generic, or unfinished?

Do not bring in external assumptions. Work entirely within existing CSS variables and Tailwind tokens.

---

## Step 2 — Read every .tsx file for the area you are working on

Before changing anything, read every `.tsx` file related to the component or page. Understand what is already there — layout structure, spacing, border radius, transitions, shadows, color assignments.

Anything you find is a starting point, not a constraint. You have full permission to change any existing visual property — a `rounded-md` can become `rounded-2xl`, a `transition-colors` can become `transition-all` with scale and shadow, a static card can gain a hover lift. The goal is that every component feels designed for this specific app, not assembled from defaults.

---

## Step 3 — Build a design direction brief before writing any code

Do not start coding until you have formed a complete design direction. Synthesise everything you know about the business — its name, type, tone, and audience — into a brief that answers all six dimensions below. This brief is what you design from. Every visual decision should be traceable back to it.

**Write out answers to these six dimensions:**

**1. Vibe / personality** — What is the emotional register of this brand? Is it bold and confident, warm and nurturing, clinical and precise, playful and fun, luxurious and restrained? Name it in one sentence. This is the filter every other decision passes through.

> Example: *"Klass is a vibe — retro-groovy meets modern bold. Confident, fun, unapologetically expressive. Like the clients who walk out of there."*

**2. Color** — What is the dominant color, the accent, and the base? Derive these from the app's existing CSS variables if set, or choose from scratch if the palette is generic. Name the emotional role of each color — dominant sets the mood, accent creates energy, base lets things breathe.

> Example: *"Rich plum/eggplant as dominant (power, creativity), warm gold/mustard as accent (energy, warmth), creamy off-white as base (breathing room). No pastels, no generic pinks."*

**3. Typography** — What is the heading font doing and what is the body font doing? Name the contrast: expressive display vs clean sans, editorial serif vs geometric mono, bold condensed vs airy light. Specify size contrast — how large should headings feel relative to body?

> Example: *"Chunky retro-inspired display font for headings — big, confident, size contrast that commands attention. Clean modern sans for body. Headlines should feel like a poster, not a label."*

**4. Layout** — Is the layout structured and grid-based, or editorial and asymmetric? Uniform icon grids feel generic — break them. Use staggered bento-style cards with varied sizes, full-bleed imagery sections, overlapping layers, or alternating left/right compositions.

> Example: *"Asymmetric, editorial. Staggered bento-style service cards with varied sizes. Full-bleed imagery sections. Never a uniform 3-column icon grid."*

**5. Visual elements** — What decorative or structural elements reinforce the personality? Organic blob shapes, wavy dividers, sharp geometric cuts, dot grids, film grain texture, gradient overlays? Name the shapes and where they appear.

> Example: *"Retro blob shapes and wavy dividers in brand colors, slight transparency, layered behind content. Shapes feel groovy — curved, organic, playful. Rich beauty photography."*

**6. Motion** — What is the motion personality? Subtle and professional, dynamic and playful, or dramatic and cinematic? Name specific effects: staggered reveals, hover lifts, floating elements, directional transitions.

> Example: *"Dynamic. Staggered fade-slide-up on section content, floating retro blob shapes in hero, hover scale + glow on service cards, smooth wavy section dividers. Bouncy but not childish, groovy but not dated."*

---

Once you have all six answers written out, use them as the filter for every decision in Steps 4–7. If a design choice can't be justified by the brief, replace it with one that can.

---

## Step 4 — Understand the business personality

The business type from discovery shapes every visual decision. Ask yourself: what would this business feel like as a physical space?

- A medical clinic wants clinical precision — clean grid, high contrast, minimal decoration
- A wellness or spa business wants warmth — generous whitespace, soft radius, gentle motion
- A fitness studio wants energy — bold type, strong contrast, sharp or dramatic edges
- A photography or creative studio wants editorial feel — asymmetric layouts, large imagery, expressive whitespace
- A professional services firm wants structured confidence — tight grid, muted palette, subtle depth
- A bold lifestyle brand (salon, studio, creative agency) wants personality — expressive typography, jewel tones, asymmetric layouts, motion that feels alive

Translate that feeling into decisions about density, radius, animation speed, and color weight.

---

## Step 5 — Creative dimensions to consider for every component

When working on any UI area, make deliberate choices across all of these dimensions. Do not default to the safe middle ground.

**Layout and composition** — Is a single column the right choice, or would an asymmetric grid, a bento layout with mixed cell sizes, a horizontal scroll, or an overlapping layered composition feel more alive? Design a path for the eye to follow.

**Whitespace** — Whitespace is a design element. Should this component breathe more to feel premium, or compress to feel information-dense? Make it a conscious decision, not a leftover.

**Border radius** — Radius communicates personality. A button, a card, an input, an avatar chip, and a dialog all deserve their own considered radius. Vary intentionally — mixing tight and generous radius within a component creates hierarchy.

**Depth and surface** — How does this element sit in space? Use shadows, border opacity, background tints, and translucency to give elements a sense of depth. A card can float above the page, rest flush with it, or recede behind it.

**Color expression** — The existing palette has more range than primary/background. Explore opacity variants, gradient combinations between tokens, tint washes, and accent pops. Ask: where could a subtle color hit make this feel more alive?

**Motion and transitions** — Every element that changes state is an opportunity to communicate quality. Think about hover response, focus states, entrance animations for content that loads, and directional transitions in multi-step flows. Motion should feel considered, not bolted on.

**Typography as design** — Size contrast, weight contrast, letter spacing, line height, and color opacity are design tools. A large quiet number, a tight uppercase label, an oversized faded heading used as texture — these are visual choices, not just readability choices.

**Interaction feedback** — Every button, hover, and form focus should feel alive. Does the element lift, glow, compress, shift color, or reveal something on interaction? Interfaces that respond well feel crafted.

---

## Step 6 — Page and component-specific direction

### /book — Service grid page

Read `src/pages/book/index.tsx` and `src/components/booking/ServiceGrid.tsx` and `src/components/booking/ServiceCard.tsx` before making changes.

The service grid is the storefront. It must feel curated, not listed. Replace any uniform column grid with a staggered, bento, or editorially composed layout. Service cards should have hover lift, image treatment suited to the business, and clear visual hierarchy — name dominates, price and duration support. The grid should make choosing feel easy and appealing.

### /book/:serviceId — Booking wizard

Read `src/pages/book/[serviceId].tsx` and `src/components/booking/BookingWizard.tsx` before making changes.

Each step of the wizard should feel like a distinct moment — not a form field swap. The wizard container needs visual weight: elevated surface, shadow, generous padding. Apply directional entrance animations as the user moves forward (slide in from right) and back (slide in from left). The transition should feel intentional, not instant.

### StepIndicator

Read `src/components/booking/StepIndicator.tsx` before making changes.

Progress must be tangible. A filled progress bar or animated step dots communicate location far better than plain numbers. The active step should feel clearly different from completed and upcoming steps. Completed steps should feel done — muted, checked, receded.

### DatePicker

Read `src/components/booking/DatePicker.tsx` before making changes. The component uses a `Calendar` UI component internally — also read `src/components/ui/calendar.tsx` to understand what CSS variables and class overrides are available.

The stock date picker looks like a utility tool. It needs to feel like part of the booking experience.

- **Touch targets:** Every date cell must be at least 44×44px. If the calendar grid is cramped, increase cell padding.
- **Selected date:** Should feel definitively chosen — use `bg-primary text-primary-foreground`, a slight scale (`scale-110`), and optionally a shadow. It should look different enough that there's no ambiguity about which date is picked.
- **Today marker:** Add a visible dot or underline under today's date that persists even when it's not selected.
- **Unavailable dates:** Muted opacity (`opacity-30`), `cursor-not-allowed`, no hover state. They should visually recede so available dates feel foregrounded.
- **Hover state on available dates:** `bg-primary/10` or a light tint — previewing the selection before commitment.
- **Month navigation arrows:** Style them to match the site's button language — not the default browser/component defaults.
- **The preset chips** ("Today", "Tomorrow", "In 3 days") already exist in the component. Style them as pill buttons using the site's border radius and muted colors, with `bg-primary/10 text-primary` on hover.

The calendar must use the site's CSS variables for all colors — never hardcode hex values.

### TimeSlotPicker

Read `src/components/booking/TimeSlotPicker.tsx` before making changes. It already splits slots into AM/PM groups — use that structure as a design asset.

The stock time slot picker is a plain button grid. It needs to feel like a deliberate selection UI.

- **Slot shape:** Pill buttons (`rounded-full`) feel lighter and more modern than square buttons for time slots. Use generous horizontal padding.
- **Three explicit states — each must look visually distinct:**
  - Available: `border border-border bg-background hover:border-primary hover:bg-primary/5 hover:text-primary` — neutral but inviting, border shifts on hover
  - Selected: `bg-primary text-primary-foreground shadow-md` — strong, confirmed, no border needed
  - Loading skeleton: Use `Skeleton` component at the same pill size — not a spinner covering the whole area
- **AM/PM section headers:** Style as a small uppercase label (`text-xs font-semibold tracking-wide text-muted-foreground`) — gives the grid structure without adding visual noise.
- **Empty state** (no slots available): A clear, sympathetic message with an option to try another date — not a blank area.
- **Grid density:** Use `grid-cols-3` or `grid-cols-4` depending on slot count. Slots should breathe — `gap-2` minimum.
- **Selected slot confirmation:** When a slot is selected, show a brief visual pulse or scale (`animate-in zoom-in-95 duration-150`) to confirm the tap registered.

### BookingDetailsForm

Read `src/components/booking/BookingDetailsForm.tsx` before making changes.

This is where users commit — the layout must feel calm and trustworthy, not rushed.

- Inputs must match the site's existing form style exactly — same border radius, same focus ring color (`ring-primary`), same placeholder text treatment.
- Labels sit tight above their input, not floating or far away.
- The submit / "Confirm Booking" button is the primary action — it should use the full primary button style, full width, and feel like a confident final step. Add a lock icon or checkmark if appropriate.
- Validation errors: gentle red text below the field, never a full red border that makes the form look broken.
- If a coupon code field is present and `customer.booking_flow.coupons` is enabled, it should feel like a bonus — tucked below the main fields, collapsible or in a lighter style.

### BookingConfirmation

Read `src/components/booking/BookingConfirmation.tsx` before making changes. It accepts `icon`, `title`, `description`, and `className` overrides — use them.

This is the emotional peak of the entire booking flow. It must feel like a celebration, not a receipt.

- **Hero moment:** Large icon or illustration at the top — not the default `CheckCircle2` in its default size. Scale it up, use the primary color, optionally animate it in (`animate-in zoom-in-75 duration-500`).
- **Confirmation message:** Large, warm heading. "You're all set!" or "[Business name] is expecting you!" — something that reflects the business personality, not "Booking Confirmed."
- **Booking summary card:** Service name, date, time, price — presented as a clean summary card with subtle background (`bg-muted/50`) and the business's border radius. Not a table, not a list of labels — a card that feels like a ticket.
- **CTAs:** At minimum — "Book another" and "View my bookings" (if customer portal is enabled). Style them distinctly: primary for the most likely next action, ghost/outline for the secondary.
- **Background:** Consider a subtle gradient, confetti, or a generated image behind the confirmation area for businesses where celebration is on-brand (spa, wellness, photography). Use the media-image skill if appropriate.
- **Color:** Use `text-primary` for the icon and heading. The overall tone should match whether the business is warm (spa), clinical (medical), or energetic (fitness).

### Admin dashboard

Read `src/pages/admin/index.tsx` and `src/components/admin/dashboard/` before making changes.

Stats should be the hero — large numbers, clear labels, trend indicators. Use grid variation in the stats row: let the most important metric have more visual weight, not a uniform 4-column row. Tables should be readable at a glance with alternating row treatment and clear action affordances. Sidebar should be visually distinct from the main content area with a clear active state.

### My Bookings (customer portal)

Read `src/pages/my-bookings/index.tsx` before making changes.

Booking status must be immediately scannable — use distinct visual treatments for upcoming, completed, and cancelled. Empty state should be encouraging, not just an absence of content: an illustration or icon with a clear CTA to book. Each booking card should surface the most decision-relevant information first: service, date, time, status.

---

## Step 7 — Generate images for visual components

Appointments UI is significantly richer when service cards, hero sections, and category tiles have real images rather than placeholder backgrounds or empty space. Use the `media-image` skill to generate them.

**Load the skill first:**

```typescript
skill({ action: 'load', skill: 'media-image' })
```

**Components that benefit most from generated images:**

| Component | What to generate |
|---|---|
| Service cards (booking page) | A photo representing the service — e.g. "relaxing massage therapy room with warm lighting" for a spa, "modern hair salon chair with mirror" for a salon |
| Hero / banner section | An atmospheric image that captures the business's feel — e.g. "serene wellness spa interior with soft natural light" |
| Category tiles (if categories are enabled) | One representative image per category |
| Staff profile cards | Professional portraits if no real photos are provided |
| Booking confirmation page | A welcoming, calming image that reinforces the booking |

**Prompt guidance — tailor every prompt to the business:**

- Reference the business type, tone, and color palette from your discovery notes
- Be specific about lighting, mood, and setting — not just the subject
- For service images: describe the *experience*, not just the procedure
- Keep prompts consistent across a set so the images feel like they belong together

**After generating, wire the image into the component:**

```typescript
// Example: service card with generated image
media_image__generate({
  prompt: "luxury deep tissue massage table with warm amber lighting, premium spa interior, soft towels, tranquil atmosphere",
  slot: "services/deep-tissue-massage",
})
```

Then reference the slot in the component via the media URL helper that exists in the app. Check `src/lib/api-client.ts` or `src/lib/appointments-client.ts` for `getPublicConfig` — it returns the media base URL used to construct image `src` values.

---

## Step 8 — Quality check before finishing

After each change, ask honestly:

- Does every interactive element visibly respond to hover, focus, and active states?
- Is there one dominant element per section that draws the eye first?
- Do the choices feel coherent with the business personality and existing theme?
- Is anything still generic — a component that could belong to any app rather than this one?
- Does the layout make interesting use of space, or is it just a vertical stack of boxes?
- Would a user notice the care and craft in this UI, even if they couldn't say why?

If the answer to the last question is uncertain, keep working.
