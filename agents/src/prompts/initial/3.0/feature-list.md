# todoList Rules

<context>
The homepage preview is visual-only — contact forms, checkout, and similar flows are built later. Preview may also show mock data (sample reviews, placeholder testimonials, fake stats) that looks real but is not wired up. Continue Building and the develop agent read this todo list when the user picks the next item, so descriptions must capture full completion scope. Otherwise preview UI can look functional while backend work and content completion stay invisible on the roadmap.
</context>

<instructions>
Call `todoList` in the same turn as `setProjectName`. Use business context only — no design thinking yet.
</instructions>

<rules>
- **4-6 FEATURES** — High-level pages or capabilities after the homepage. Always start with "Homepage".
- **USER-FACING ITEMS** — One item per feature the user recognizes. Not implementation steps or separate API/backend rows.
- **NAME BACKEND IN DESCRIPTIONS** — If a feature needs skills or backend after preview (inbox, commerce, payment, database, auth, integrations), say so on that item.
- **PREVIEW DEFERRAL** — Homepage preview defers backend UI. If the homepage implies a deferred flow (contact form, order CTA, signup, newsletter), mark Homepage preview-only and put completion on Contact, Online ordering, etc.
- **PLACEHOLDER COMPLETION** — If preview shows mock or placeholder data (sample reviews, fake stats, lorem testimonials, stock product names), the owning item must say what completion means: live integration, database-backed real data, or real user-provided content replacing placeholders.
- **STATIC STAYS UI-ONLY** — About, Gallery, Team, FAQ without forms — do not invent backend scope.

✅ Contact: "Location, hours, and inquiry form (inbox skill + working submissions)"
✅ Homepage with order CTA: preview-only note; Online ordering owns commerce + payment
✅ Reviews with mock cards on homepage: Reviews item owns live Google feed (google-maps skill)
✅ Testimonials with placeholder quotes: "Replace sample quotes with real client testimonials (user-provided content)"
✅ Static About: "Story, values, and team"
❌ Thin Contact when user needs a form: "Location, hours, and directions" only
❌ Thin Reviews: "Customer reviews section" when homepage showed fake stars — no mention of live data or placeholder replacement
❌ Separate "Set up inbox" row — backend belongs in the feature description
❌ Inbox or database on About/Gallery when the user did not ask for forms
</rules>

<example>
Coffee shop with ordering and contact form:

```json
{
  "operation": "create_list",
  "listName": "Morning Grounds",
  "items": [
    {
      "title": "Homepage",
      "description": "Landing with hero, menu highlights, and ordering CTA (preview only — ordering and contact backend on items below)"
    },
    { "title": "Full menu", "description": "Menu with categories, prices, and descriptions" },
    {
      "title": "Online ordering",
      "description": "Order-ahead UI, payment capture, and checkout (commerce + payment skills)"
    },
    { "title": "About page", "description": "Story, values, and team" },
    {
      "title": "Contact",
      "description": "Location, hours, and inquiry form (complete inbox skill + working submissions)"
    }
  ]
}
```
</example>
