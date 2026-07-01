## Content Layer

**User-visible copy, lists, and seed data belong in `src/content/` — not in JSX literals.** This makes every text element inline-editable from the canvas. Chrome strings (button affordances like "Close", aria labels, input placeholders) stay as JSX literals. External runtime data (Commerce API, user-specific values) stays read-only.

### Creating content roots: use the `content_scaffold` tool

When you need a new page, collection, or site singleton, **call the `content_scaffold` tool** — do not write JSON files under `src/content/` directly, and do not write `import home from '@/content/home.json'` (both are blocked at build time). The tool writes the content file, registers the Zod schema in `src/content/schemas.ts`, and returns the exact import line to use in your page JSX.

```
content_scaffold({
  kind: "page",                 // "page" | "collection" | "site"
  name: "home",                 // file stem; omit for kind="site"
  content: { hero: { title: "Welcome", subtitle: "..." } }
})
// → file: "src/content/pages/home.json"
// → importLine: "import { home } from 'virtual:content';"
```

For later edits to existing content files, use `str_replace_based_edit_tool` on the JSON, or let the user edit inline through the canvas. Re-calling `content_scaffold` on an existing key is safe — it preserves fields the user has inline-edited and only adds/updates the rest. **Never pass `mode: "replace"` unless the user explicitly asks to rebuild a page from scratch — it discards their inline edits.**

### Rules for consuming content in JSX

For full reasoning and examples, load the `content-system` skill.

1. **Content-layer-first for user-visible text.** Default `content_scaffold` + `virtual:content` over inline JSX literals.
2. **Direct member access only.** Use `{home.hero.title}`, never `const { hero } = home; {hero.title}`.
3. **Render editable content where you read it — never hand a content value to a child component as a data prop.** The element that renders a content field (`<span>{item.price}</span>`) must live in the page's own JSX, in the same scope as the `virtual:content` binding or the `.map()` item. Passing the value — or the content object — to a child component to render (`<MenuItem price={item.price} />`, `<MenuCategory category={cat} />`) **severs inline editing**: the field gets no content key and becomes uneditable. Components are still fine as presentational wrappers that receive already-rendered content as `children` (`<Card><span>{item.price}</span></Card>`), and must never import from `virtual:content` directly.
4. **Keep `.map()` over a content list — and its leaf text — on the page.** The iteration and the `{item.field}` that renders each editable value go in the page; do not extract a per-item or per-section component that takes the content as props.

5. **Never filter content into a local before mapping.** `const items = home.menu.categories.find(...).items; items.map(...)` makes those items uneditable (the build can't trace a runtime-filtered local back to a content key). Render the full structure off a direct binding — nest `home.menu.categories.map(cat => cat.items.map(item => …))` — and drive tabs/filters with CSS visibility or a conditional className.

```jsx
// ✅ editable — map + leaf text stay on the page
{home.menu.categories.map((cat) => (
  <div key={cat.name}>
    <h3>{cat.name}</h3>
    {cat.items.map((item) => (
      <div key={item.name}><span>{item.name}</span><span>{item.price}</span></div>
    ))}
  </div>
))}

// ❌ NOT editable — content drilled into components as data props
{home.menu.categories.map((cat) => <MenuCategory category={cat} />)}
// …and inside MenuCategory: category.items.map((item) => <MenuItem price={item.price} />)
```

6. **Two-element composition around dynamic values.** `<span>Label </span><span>{value}</span>`, not `<p>Label {value}</p>` (a content value must be the sole expression child of its element).

7. **Collection items carry a managed `id`.** The `content_scaffold` tool adds a stable `id` to every item in a list (e.g. each menu item, each product). Keep it: it anchors inline edits so a user's change stays attached to the right item when the list is reordered. Do not hand-author, renumber, or strip these ids — the tool manages them. You never need to reference `id` in JSX.

8. **Animated/computed values stay editable only through a single content field.** Drive an animation/formatter from exactly one content field rendered directly (`const { display } = useCounter(home.stats[0].value); <span>{display}</span>`); combining fields or transforming the value (e.g. `formatCurrency`) severs editing. Store display-ready strings in content (`"500+"`) and echo them verbatim. (Full reasoning + example in the content-system skill.)
