---
name: react-patterns
description: React authoring patterns for @airo-ux/pattern-library. Use when writing a new component, fixing render/perf issues, or deciding how to shape props, state, effects, and async work. Focused on primitive/library-level code — not app-level concerns (data fetching, routing, bundling). Pairs with the `review` skill, which enforces the same rules at PR time.
license: Proprietary
metadata:
  author: airo-components
  version: "1.0.0"
  category: developer-tools
acknowledgments: |
  Adapted from the Mastra/Vercel `react-best-practices` skill
  (https://github.com/vercel-labs/agent-skills), trimmed to the rules
  that apply to a re-usable component library.
---

# React Patterns — authoring components in `@airo-ux/pattern-library`

This skill is the **authoring-time** counterpart to the `review` skill.
The review skill flags these patterns at PR time; this skill tells you
how to write code that doesn't trip them.

Scope: patterns that apply to re-usable, library-level React components.
Out of scope: data fetching strategy (not allowed in this repo — see
[`BUSINESS-LOGIC.md`](../review/references/BUSINESS-LOGIC.md)),
bundling choices for apps, routing, server components.

## When to use this skill

DO use when:

- Writing a new component under `src/<area>/<name>/`.
- Refactoring an existing component for clarity or perf.
- Debugging an unexpected re-render or stale-state bug.
- Deciding whether a `useEffect`, `useMemo`, or `useCallback` is
  pulling its weight.

DO NOT use for:

- Deciding the file layout, exports, or README shape — see the
  `component-authoring` rule and the `review` skill.
- UXCore2 composition or intent-token usage — see the `uxcore` skill.
- Accessibility — see the `accessibility` skill.

## Priority order

Apply rules in this order. The ones at the top do the most work for the
least thought.

| Rank | Rule | Impact | Flagged by `review` as |
|------|------|--------|------------------------|
| 1 | Minimise `useEffect` | Critical | Critical |
| 2 | Never mutate props or state | Critical | Critical |
| 3 | `Promise.all` for independent async | Critical | Critical / Important |
| 4 | Stable keys in lists | Medium | Important |
| 5 | Lazy `useState` initialiser | Medium | Important |
| 6 | `useMemo` / `useCallback` only when they matter | Low | Minor |
| 7 | Hoist regex / large literals out of render | Low | Minor |
| 8 | `Set` / `Map` for repeated lookups | Low | Minor |

## 1. Minimise `useEffect`

`useEffect` exists to synchronise React with an **external system**
(DOM APIs, event sources, third-party imperative libraries). It's not
for derived values, not for resetting state, not for calling handlers.

### Derived state → compute inline

```tsx
function StatusBadge({ status }: { status: 'idle' | 'pending' | 'done' }) {
  const label =
    status === 'idle' ? 'Ready'
    : status === 'pending' ? 'Working...'
    : 'Done';
  return <span>{label}</span>;
}
```

Not:

```tsx
const [label, setLabel] = useState('Ready');
useEffect(() => {
  if (status === 'idle') setLabel('Ready');
  else if (status === 'pending') setLabel('Working...');
  else setLabel('Done');
}, [status]);
```

### Resetting state on prop change → use `key`

If a parent needs a child to reset when some identity changes, pass
`key`:

```tsx
<MessageBubble key={message.id} message={message} />
```

Don't:

```tsx
function MessageBubble({ message }: Props) {
  const [edits, setEdits] = useState(message.body);
  useEffect(() => {
    setEdits(message.body);
  }, [message.id]);
  // …
}
```

### Calling handlers on events → call them in the event handler

```tsx
<button onClick={() => { setOpen(true); onOpen?.(); }} />
```

Not:

```tsx
useEffect(() => {
  if (open) onOpen?.();
}, [open, onOpen]);
```

**Rule of thumb**: if your `useEffect` reads and writes React state,
it's almost certainly the wrong tool. A new `useEffect` in a PR must
earn its place — either subscribe/unsubscribe to an external source,
or it doesn't belong.

## 2. Never mutate props or state

React state is append-only from the component's point of view — every
update produces a new value, never a mutation of the old one. Mutation
breaks reconciliation (same reference → React assumes nothing changed)
and leaks updates back to consumer-owned data.

Good:

```ts
const next = [...items, newItem];
setValue(nextValue);
```

Bad:

```ts
props.items.push(newItem);   // mutates consumer data
state.value = nextValue;     // mutates own state
items.sort(compareFn);       // mutates — use [...items].sort() or items.toSorted()
```

## 3. `Promise.all` for independent async

If a component does any async work internally (rare, but happens for
streaming components, `navigator.clipboard`, `ResizeObserver` setup),
don't chain independent awaits.

```ts
const [clipboard, resize] = await Promise.all([
  navigator.clipboard.readText(),
  waitForResize(containerRef.current),
]);
```

If one call depends on the result of another, sequential is correct.

Components do not fetch data from the network — see
[`BUSINESS-LOGIC.md`](../review/references/BUSINESS-LOGIC.md). This
rule is about the small amount of async work a component legitimately
wraps.

## 4. Stable keys in lists

Keys must be stable per item across renders. `key={index}` is a bug
waiting to happen on any list the consumer might reorder, filter, or
insert into.

```tsx
{messages.map((m) => <MessageBubble key={m.id} message={m} />)}
```

Only use `key={index}` when the list is:

- Demonstrably append-only, **and**
- You've documented it in a comment next to the `.map`.

## 5. Lazy `useState` initialiser for expensive defaults

`useState(initial)` evaluates `initial` on every render; React just
ignores the result after the first one. For anything beyond a literal,
pass a function:

```tsx
const [id] = useState(() => generateId());
const [model] = useState(() => buildInitialModel(props));
```

Not:

```tsx
const [id] = useState(generateId());          // called every render
const [model] = useState(buildInitialModel(props));
```

## 6. `useMemo` / `useCallback` only when they matter

Default is **no memoisation**. Only reach for `useMemo` / `useCallback`
when you can state the concrete reason:

- The value is passed to a memoised child that will re-render on
  reference change.
- The computation is measurably expensive (you profiled it, or it's
  obviously O(n²) over a non-trivial n).
- A ref equality check downstream depends on identity.

Memoising a primitive expression (`useMemo(() => x + 1, [x])`) or a
cheap array (`useMemo(() => [a, b], [a, b])`) adds render overhead and
noise. It's a Minor finding in review.

For event handlers specifically, on React 19+ consider `useEffectEvent`
over `useCallback` when the handler doesn't need dependency tracking —
this repo isn't on 19 yet, so `useCallback` or an inline function are
both fine.

## 7. Hoist regex / large literal objects out of render

```ts
const SPACES = /\s+/g;
const DEFAULT_STYLE: CSSProperties = { display: 'inline-flex' };

export function Foo() {
  return <div className={name.replace(SPACES, '-')} style={DEFAULT_STYLE} />;
}
```

Not:

```tsx
export function Foo() {
  const spaces = /\s+/g;                      // new regex per render
  const style = { display: 'inline-flex' };   // new object per render
  // …
}
```

The practical cost is small; the bigger issue is that inline objects
break prop-equality-based memoisation in children.

## 8. `Set` / `Map` for repeated lookups

If you call `.includes` or `.find` on the same array more than a
couple of times per render, build a `Set`/`Map` once:

```ts
const activeIds = new Set(active);
items.filter((i) => activeIds.has(i.id));
```

Not:

```ts
items.filter((i) => active.includes(i.id));  // O(n*m)
```

## Quick self-review

Before opening a PR, run this three-question pass over every
`useEffect`, `useMemo`, `useCallback`, and `useState`:

1. **`useEffect`** — is it synchronising with an external system? If
   not, replace it (see rule 1).
2. **`useState`** — does the initial value come from a function call?
   If yes, is it wrapped in `() => …`?
3. **`useMemo` / `useCallback`** — can you name the memoised consumer
   or the expensive computation? If not, drop the hook.

## Reference

Full rule set (including app-level rules not in scope here — Tanstack
query dedupe, bundle-barrel-imports, `startTransition`, SVG animation
wrappers, `content-visibility`) lives in the upstream Mastra/Vercel
`react-best-practices` skill.

Paired with `review` — every rule here has a matching rule ID under
the `perf-` or `api-` prefix in `.agents/skills/review/references/`
so PR-time feedback and authoring-time guidance use the same
vocabulary.
