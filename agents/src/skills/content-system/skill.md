---
name: content-system
enablementId: contentSystem
description: Structure user-visible content through the app's content layer (src/content/) so every text element is inline-editable from the canvas.
whenToUse: Always when creating or editing pages, lists of items (products, testimonials, nav, pricing tiers), hero sections, or any user-visible copy. Not for chrome strings (button affordances, aria labels) or UI primitives in src/components/ui/.
---

# Content-System Skill

**Purpose:** Route all user-visible app-owned text through `src/content/` so the builder's edit mode can inline-edit any copy or data field — the same way it edits JSX literals today.

---

## The Mental Model

User-facing text in a generated app belongs to one of three classes:

| Class                                                              | Source                                                            | Edit path                                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| **App-owned content** (copy, testimonials, products, nav)          | `src/content/**` JSON files validated by `src/content/schemas.ts` | Content-edit endpoint (CMS path)            |
| **Chrome / structural** (button labels like "Close", aria strings) | JSX literals                                                      | AST-edit path                               |
| **External data** (Commerce API, per-user data, inventory)         | Runtime fetch / props from outside the app                        | Read-only; edit the adjacent labels instead |

Default user-visible text to **app-owned content**. Only use JSX literals for chrome strings.

---

## File Layout

```
src/content/
├── schemas.ts          # Zod schemas; shape defined per app
├── site.json           # Singleton: brand, tagline, nav, footer
├── pages/
│   ├── home.json
│   └── <page>.json
└── data/
    ├── products.json   # Arrays / collections
    └── <list>.json
```

Filenames become export keys via `virtual:content`:

```ts
import { site, home, products } from 'virtual:content';
```

## Five Rules for Content-Driven JSX

These rules make inline editing work. Violating any one makes the element non-editable.

### 1. Content-layer-first for user-visible text

Default to `src/content/` entries. Inline JSX literals are allowed only for:

- Button affordances that are structural (e.g., a `<Close />` icon's `aria-label`)
- Strings inside shared `src/components/ui/` primitives (excluded from attribution)
- Placeholder text in inputs

### 2. Direct member access only

```tsx
// OK — edit mode can resolve the content key
<h1>{home.hero.title}</h1>;

// Wrong — destructured binding is invisible to the source-mapper plugin
const { hero } = home;
<h1>{hero.title}</h1>;
```

If you need a shorter alias for readability, inline the access at the JSX site:

```tsx
<section>
  <h1>{home.hero.title}</h1>
  <p>{home.hero.subtitle}</p>
</section>
```

### 3. Render editable content where you read it — never pass a content value into a component as a data prop

The element that renders a content field must live in the page's own JSX, in the same scope as the `virtual:content` binding (or the `.map()` item). If you hand the value — or the content object — to a child component to render, source-mapper can't attribute it (inside the component the value is just a prop, not a content path) and the field becomes **uneditable**.

```tsx
// ✅ the page reads AND renders the content; <Card> is a presentational wrapper
//    that receives the already-rendered content as `children`
// src/pages/storefront.tsx
import { products } from 'virtual:content';
{products.map((p) => (
  <Card key={p.id}>
    <h3>{p.name}</h3>
    <span>{p.price}</span>
  </Card>
))}

// ❌ content drilled into a component as a data prop → {p.name}/{p.price} render
//    inside ProductGrid where `products` is a prop → no content key → uneditable
<ProductGrid products={products} />
```

A component must never `import … from 'virtual:content'`, and must never receive a content value/object that it then renders. Presentational wrappers (`Card`, `Grid`) are fine — they receive already-rendered content-bound elements as `children`.

### 4. A content value is the sole expression child of its own element

```tsx
// ✅ {product.price} is alone in its <span> — cleanly editable
<span>Starting at </span><span>{product.price}</span>

// ❌ mixed children leave the parent between edit paths
<p>Starting at {product.price}</p>
```

### 5. Keep `.map()` over a content list — and its leaf text — on the page

```tsx
import { products } from 'virtual:content';
{products.map((p) => (
  <div key={p.id}>
    <h3>{p.name}</h3>
    <span>{p.price}</span>
  </div>
))}
```

source-mapper auto-tags each item with its content field + per-item index, so edit-mode resolves `{p.name}` back to `products[3].name` at click time — **as long as the `.map()` and the `{p.field}` leaf stay in the page's own JSX** (not extracted into a per-item/per-section component that takes the content as props). The `<ContentListContext field="…">` wrapper from `@airo/content` is an optional fallback for shapes the auto-tagging can't reach; it is not required.

### 6. Never filter content into a local before mapping

`const items = home.menu.categories.find(...).items; items.map(...)` makes those items uneditable — the build can't trace a runtime-filtered local back to a content key. Render the full structure off a direct binding (`home.menu.categories.map(cat => cat.items.map(item => …))`) and drive tabs/filters with CSS visibility or a conditional className.

### 7. Collection items carry a managed `id`

The `content_scaffold` tool adds a stable `id` to every item in a list. Keep it — it anchors inline edits to the right item even when the list is reordered. Do not hand-author, renumber, or strip these ids; the tool manages them completely. The `id` field never needs to appear in your JSX.

### 8. Animated/computed values stay editable only through a single content field

When a content value is rendered through an animation hook or formatter (e.g. an animated counter), call it with exactly ONE content field and render the result directly — the build traces the returned local back to its content key, and an edit re-drives the animation.

```tsx
// ✅ editable — single content field through one call, rendered as the sole child
function StatCounter() {
  const { display } = useCounter(home.stats[0].value); // home.stats[0].value = "124,000+"
  return <span>{display}</span>;
}

// ❌ severs editing — transforms the value (displayed "124,000" ≠ stored 124000),
//    so the edit is refused and the user is told to ask the agent
const display = formatNumber(useCountUp(home.stats[0].value)); // "124,000"
```

Two things sever it: combining multiple content fields in the call, or transforming the value so the displayed text no longer matches the stored content. So store the **display-ready** string in content (`"124,000+"`, `"$5.00"`, `"4.9★"`) and echo it verbatim through the animation rather than formatting a raw number at render time.

---

## Schema Authoring

Schemas live in `src/content/schemas.ts` and are composed from Zod primitives. Keep primitives as raw Zod; define composites per app:

```ts
import { z } from 'zod';

const Image = z.object({ src: z.string(), alt: z.string() });
const Link = z.object({ href: z.string(), label: z.string() });

const Product = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  image: Image,
});

export const schemas = {
  site: z.object({ brand: z.string(), tagline: z.string(), nav: z.array(Link) }),
  home: z.object({
    hero: z.object({ title: z.string(), subtitle: z.string(), image: Image.optional() }),
  }),
  products: z.array(Product),
};

export type Schemas = typeof schemas;
```

The key name (`site`, `home`, `products`) must match the filename stem (`site.json`, `pages/home.json`, `data/products.json`).

Validation runs at module-eval time in the browser. Invalid content → Vite HMR shows an overlay with the Zod error, the edit is undone by the user.

---

## Generation Order

When creating a new page:

1. **Schema first.** Update `src/content/schemas.ts` with any new composite shapes.
2. **Content second.** Write `src/content/pages/<page>.json` or `src/content/data/<list>.json` matching the schema.
3. **Presentation last.** Write `src/pages/<page>.tsx` importing from `virtual:content` and following the five rules above.

This order lets Zod validation catch shape mismatches on the first write rather than when JSX fails to load.

---

## Editing Existing Content

Edit content files directly with `str_replace_based_edit_tool`. Validate by running the build — Zod runs at module-eval time and surfaces shape errors. For bulk content changes (seeding a new list), write the file once; Zod validates on the next read.

Canvas-driven inline edits go through a separate path: the dev-tools iframe sends `CONTENT_UPDATED` messages which the BFF routes to `POST /apps/:id/content/edit`, bypassing the agent entirely.

---

## Retrofitting a Pre-CMS App

When a user asks to "convert this to CMS" or "make text editable" for an existing app that predates the content layer:

1. **Identify user-visible text.** Walk `src/pages/` and `src/components/` (excluding `src/components/ui/`). Categorize each literal string: app-owned copy, chrome, or data.
2. **Compose schemas.** Add composite Zod shapes to `src/content/schemas.ts` for any novel content kinds. Reuse primitives (`z.string()`, `z.number()`, etc.) — no new "content primitives" library.
3. **Extract content files.** Create `src/content/pages/<page>.json` files with the extracted strings. For repeated data (cards, lists), extract to `src/content/data/<list>.json`.
4. **Update JSX.** Replace inline literals with `{content.path.to.field}` references following the five rules (direct member access, ContentListContext around maps, two-element composition around external values).
5. **Verify.** Run the content-rules lint (`checkContentRules` in `agents/src/tools/content-rules-lint.ts`) over the app to catch common mistakes. Run `pnpm run build` to confirm Zod validation passes at module-eval time.

Retrofit is behavior-preserving: the rendered output should be identical byte-for-byte aside from the edit-mode attributes.

## Known Limitations (v1)

- **MDX/rich-text deferred.** Rich-text fields (`kind: 'richText'`) are stored as markdown strings but v1 has no inline Lexical editor. They're edited via the agent or a plain textarea. Full Lexical integration comes in Phase 4 alongside the Lexical branch merge.
- **No schema-primitive sharing across apps.** `src/content/schemas.ts` is per-app. Schema edits in one app don't propagate.
- **`.map()` attribution requires `ContentListContext`.** Without it, items render but can't be clicked for edit.
- **Derived values are editable only when pass-through.** A content value rendered through a single-field animation/hook is editable (see rule 8), but a value the render *transforms* (formatters, multi-field combinations) is not — the edit is refused at save time. Store the display-ready string in content instead.
