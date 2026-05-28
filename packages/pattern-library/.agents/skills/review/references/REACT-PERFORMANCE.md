# React Performance

Priority-ordered rules for reviewing component code. Rules are tagged by
impact: **Critical** (flag as Critical), **Medium** (flag as Important),
**Low-Medium** (flag as Minor).

## Critical

### Avoid request waterfalls

If a component issues multiple independent async calls, run them in
parallel.

Bad:

```ts
const user = await fetchUser(id);
const posts = await fetchPosts(id); // waits on user, but doesn't need it
```

Good:

```ts
const [user, posts] = await Promise.all([fetchUser(id), fetchPosts(id)]);
```

(In practice this library doesn't fetch — see
[`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) — but the same rule applies
to any async work the component does wrap.)

### Don't mutate props or state directly

Always derive new values. Mutation breaks reconciliation and creates
invisible bugs.

Bad:

```ts
props.items.push(newItem);    // mutates consumer data
state.value = nextValue;      // mutates own state
```

Good:

```ts
const next = [...items, newItem];
setValue(nextValue);
```

### Minimise `useEffect`

`useEffect` is for synchronising with external systems (DOM, browser API,
event source). Don't use it to:

- Derive state from props → compute inline or with `useMemo`.
- Reset state when a prop changes → use a `key`.
- Call handlers on event → call them in the event handler.
- Fetch data → see [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) (not
  allowed here anyway).

A PR that adds a new `useEffect` must justify it in the JSDoc or PR
description. "Effect that sets state based on props" is almost always the
wrong pattern.

## Medium (flag as Important)

### Lazy `useState` initialiser for expensive defaults

```ts
const [x, setX] = useState(() => computeInitial(props)); // runs once
// not
const [x, setX] = useState(computeInitial(props));       // runs every render
```

### `useMemo` / `useCallback` only when they matter

Default to not memoising. Only memoise when:

- The value is passed to a memoised child whose identity matters.
- The computation is genuinely expensive (measurable).

Unnecessary memoisation adds render overhead and obscures intent. A PR that
adds `useMemo` around a cheap computation is a Minor finding.

### Stable keys in lists

Keys must be stable per item across renders. `key={index}` is a bug
waiting to happen with reorderable lists — flag as Important unless the
list is demonstrably append-only and the author says so in a comment.

### `startTransition` for non-urgent updates

If a component drives a heavy render that's triggered by a typing or
pointer event, wrap the non-urgent update in `startTransition` so input
stays responsive.

## Low-Medium (flag as Minor)

### Avoid barrel imports from large packages

`import { Foo } from 'big-lib'` where `big-lib`'s root `index.js` re-exports
everything forces bundlers to include the whole module graph. Prefer
scoped imports:

```ts
import Foo from 'big-lib/Foo'; // if the package supports deep imports
```

This is mostly relevant for dev dependencies; `@ux/*` packages already
ship per-component subpaths, so use those (e.g. `@ux/box`, not a barrel).

### `Set` / `Map` for repeated lookups

If you look up membership in an array more than a couple of times per
render, put the members in a `Set`. Linear `.includes` in a render loop
is a Minor perf finding.

### `toSorted()` over mutating `.sort()`

`[...items].sort(…)` and `items.toSorted(…)` (ES2023) both avoid mutating
the input. Inline `items.sort(…)` mutates — that's a correctness bug
disguised as a perf one.

### Avoid re-creating regex / object literals in render

Hoist regex and large literal objects out of the component body:

```ts
const SPACES = /\s+/g; // module scope

export function Foo() { … }
```

## Review red flags

- New `useEffect` that derives state from props — Critical (ask to move to
  inline/`useMemo` or use a `key`).
- Direct mutation of props or state — Critical.
- `Promise.all`able async calls chained sequentially — Critical for
  latency-sensitive paths, Important otherwise.
- `useState(computeInitial())` with a non-trivial compute — Important.
- `useMemo`/`useCallback` around trivially cheap values — Minor.
- `key={index}` on a reorderable list — Important.
- Large object / regex literal inline in a hot render path — Minor.
- `.sort()` mutating the input array — Important (correctness concern).
