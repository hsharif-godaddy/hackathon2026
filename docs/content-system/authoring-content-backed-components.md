# Authoring content-backed, inline-editable components

A guide for teams (Blog, Commerce, …) writing components and templates that should be
**inline-editable** in the Airo builder. Follow these patterns and the text you render
becomes editable in place; ignore them and the same text renders fine but can't be edited.

> **Canonical sources** (this doc is the human-friendly version — when in doubt, these win):
> - Rules the agent follows: `agents/src/prompts/develop/content-layer.md`
> - Rules the linter **enforces**: `agents/src/tools/content-rules-lint.ts`
> - The `virtual:content` build plugin: `app-templates/v8/content-plugin/`
> - Edit-time attribution (Babel transform): `app-templates/v8/source-mapper/`

## Why this exists

The builder lets users click any piece of copy in their site and edit it in place. For that to
work, the rendered DOM element has to be traceable back to a specific piece of content. The
content system makes that link automatic: you keep user-visible copy in `src/content/*.json`,
read it through a `virtual:content` import, and a build-time transform tags each rendered
element with the content path it came from.

```
src/content/*.json   →   import { x } from 'virtual:content'   →   page JSX   →   source-mapper
   (the data)              (typed, schema-validated access)        {x.title}     tags <h1 data-dev-content-key="…">
                                                                                        │
                                                                          builder resolves the click → edits x.title
```

The single rule behind every rule below: **the build can only attribute a content value to an
element when it can statically see the path from the `virtual:content` binding to the element
that renders it.** Anything that hides that path (destructuring, passing through props, filtering
into a local) breaks editability.

## The model

### Directory layout

`content_scaffold` (the agent tool) creates and owns `src/content/`:

| File | Export key | Use |
| --- | --- | --- |
| `src/content/site.json` | `site` | Site-wide singletons (brand, tagline) |
| `src/content/pages/<name>.json` | `<name>` | Per-page content roots (`home`, `about`) |
| `src/content/data/<name>.json` | `<name>` | Collections — arrays (`products`, `testimonials`) |
| `src/content/schemas.ts` | — | Zod schemas; content is validated at module load |

Available keys are typed in `src/content/virtual-content.d.ts` (generated) — your editor will
autocomplete them.

### Consuming content

```tsx
import { site, home, products } from 'virtual:content';
```

- **Pages only.** Import `virtual:content` from `src/pages/*`, never from `src/components/*`.
  Components receive already-rendered content as `children`/props.
- **Never import the JSON directly.** `import home from '@/content/pages/home.json'` is blocked
  by the build plugin (it throws) — direct imports bypass schema validation and attribution.

### Collections carry a managed `id`

`content_scaffold` mints a stable `id` on every array item. Keep it (use it as your React
`key`); don't hand-author, renumber, or strip ids — it anchors a user's edit to the right item
when a list is reordered.

## The rules

Each rule maps to the lint rule (in `content-rules-lint.ts`) that enforces it.

### 1. Put user-visible copy in the content layer
Hardcoded copy in a page isn't editable. Move it to `src/content` and read it through
`virtual:content`.
→ enforced by `missed-content-opportunity` (3+ inline strings, no content import) and
`local-content-object` (copy stuffed into a local object literal).

### 2. Use direct member access — don't destructure
```tsx
// ✅ the path home.hero.title is visible to the transform
<h1>{home.hero.title}</h1>

// ❌ destructured binding hides the path
const { hero } = home;
<h1>{hero.title}</h1>
```
→ enforced by `destructured-content-import`.

### 3. Render where you read — don't pass content into a component as a data prop
The element that renders a content field must live in the page's own JSX, in the same scope as
the binding (or the `.map()` item). Hand the value to a child component and the path is lost.
```tsx
// ✅ page renders the content; <Card> is a presentational wrapper around children
{products.map((p) => (
  <Card key={p.id}>
    <h3>{p.name}</h3>
    <span>{p.price}</span>
  </Card>
))}

// ❌ content drilled into a component → {p.name} renders where there's no content path
<ProductGrid products={products} />
```
→ enforced by `content-prop-drill` and `component-imports-content`.

### 4. A content value is the sole expression child of its element
```tsx
// ✅ {product.price} is alone in its <span>
<span>Starting at </span><span>{product.price}</span>

// ❌ mixed children — the element straddles static text and a content value
<p>Starting at {product.price}</p>
```
(The transform auto-wraps some mixed cases, but authoring them cleanly is the contract.)

### 5. Keep `.map()` over a content list — and its leaf text — on the page
```tsx
{products.map((p) => (
  <div key={p.id}>
    <h3>{p.name}</h3>
    <span>{p.price}</span>
  </div>
))}
```
The transform auto-tags each item with its content path + per-item index, so `{p.name}` resolves
back to `products[3].name` at click time — **as long as the `.map()` and the `{p.field}` leaf
stay in the page's JSX** (not extracted into a per-item component). For an explicit wrapper, the
`ContentListContext` component lives in `app-templates/v8/content-lib/` (check the template for
the import specifier).
→ enforced by `map-without-list-context`.

### 6. Don't filter a content collection into a local before mapping
```tsx
// ❌ a runtime-derived local has no content path
const featured = products.filter((p) => p.featured);
{featured.map((p) => <Card key={p.id}>{p.name}</Card>)}

// ✅ map the direct binding; drive tabs/filters with CSS visibility or a conditional className
{products.map((p) => (
  <Card key={p.id} style={{ display: p.featured ? undefined : 'none' }}>{p.name}</Card>
))}
```
→ enforced by `content-derived-array-map`. (Same applies to `.find()`/`.slice()`/`.flatMap()`.)

### 7. Consume only through `virtual:content`
Never import a file under `src/content/` directly — always go through the virtual module.
→ enforced by `direct-content-import`.

## Worked example

```tsx
// src/pages/storefront.tsx
import { store, products } from 'virtual:content';

export default function Storefront() {
  return (
    <main>
      <h1>{store.heading}</h1>            {/* → data-dev-content-key="store.heading" */}
      <p>{store.intro}</p>
      <div className="grid grid-cols-3">
        {products.map((p) => (
          <article key={p.id}>          {/* item tagged with list path + index + id */}
            <h3>{p.name}</h3>            {/* → data-dev-content-key-template="products[].name" */}
            <span>{p.price}</span>
          </article>
        ))}
      </div>
    </main>
  );
}
```

## Commerce / external data is read-only — not `src/content`

Live Commerce API data (catalog, prices coming from the store backend) is **not** content and
must **not** be routed through `virtual:content`. The builder renders it as **read-only**: the
transform marks those elements `data-dev-source-origin="commerce"` so the inline editor leaves
them alone. Use the Commerce components/data for live store data; use `src/content` only for
authored copy the site owner should be able to edit.

## Lint cheat-sheet

| Lint rule | Triggers when… | Fix |
| --- | --- | --- |
| `missed-content-opportunity` | a page has 3+ inline copy strings (≥10 chars) and no `virtual:content` import | scaffold content, import it |
| `local-content-object` | a page stuffs copy into a local object literal | move it to `src/content` |
| `destructured-content-import` | a `virtual:content` binding is destructured | use direct member access |
| `component-imports-content` | a `src/components/*` file imports `virtual:content` | import in the page; pass rendered JSX as children |
| `content-prop-drill` | a content-rooted value is passed as a component prop | render it inline on the page |
| `map-without-list-context` | a `.map()` over a content list isn't wrapped/attributed | keep the map + leaf on the page (or wrap in `ContentListContext`) |
| `content-derived-array-map` | mapping a collection derived via `.find()/.filter()/.slice()` | map the direct binding; filter with CSS |
| `direct-content-import` | importing a file under `src/content/` directly | import from `virtual:content` |

## References

- `agents/src/prompts/develop/content-layer.md` — the rules as the agent sees them
- `agents/src/tools/content-rules-lint.ts` — the enforced rule set (source of truth for messages)
- `app-templates/v8/content-plugin/` — the `virtual:content` Vite plugin (discovery, validation, direct-import guard)
- `app-templates/v8/source-mapper/` — the Babel transform that tags elements with `data-dev-content-key*`
- `app-templates/v8/content-lib/` — `ContentListContext` and content runtime helpers
