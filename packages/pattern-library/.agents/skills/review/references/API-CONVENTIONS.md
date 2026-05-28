# API Conventions

Public API is part of the product. Every PR that adds or changes an export
is a contract change — review it with that posture.

## Exports

- **Named exports only.** No `export default`. `export default` is a
  Critical finding.
- The component exports its `Props` interface alongside it (shown here
  with a generic `<Name>` — substitute your component's name):

  ```ts
  export { <Name> };
  export type { <Name>Props };
  ```

- Compound sub-parts attach via dot-notation **after** the function
  expression. Shown here for a hypothetical `Menu`:

  ```ts
  export function Menu() { … }
  Menu.Item = MenuItem;
  Menu.Trigger = MenuTrigger;
  ```

  Do not export sub-parts as bare top-level exports unless they are also
  useful standalone.

- The component's `index.ts` re-exports only:
  - The component itself.
  - Its `Props` type(s).
  - Any publicly-useful helpers (e.g. a predicate, a type guard). Keep this
    surface small — every new export is a breaking-change risk.

## JSDoc (mandatory on every public export)

Every symbol that leaves the component directory — the component, its
`Props` interface, every prop on that interface, every exported helper
or type — **must** have a JSDoc block. JSDoc is not optional polish
here: ts-morph reads these comments and pipes them into the MCP codex
via Aichemy's `typescript()` processor (see [`AGENTS.md`](../../../../AGENTS.md)
→ "Keeping the MCP in sync"). Comments missing here are missing from
the product — IDE tooltips are blank, the codex shows `undefined`, and
every downstream agent consuming the MCP has less to work with.

### What to document

- **Component.** One or two sentences describing what it is and its
  primary role. Include `@example` with a minimal, runnable snippet
  that a consumer can copy. Cross-reference the component's
  `README.md` with `@see` when the usage guidance lives there. Shown
  here for a hypothetical `Disclosure`:

  ```ts
  /**
   * Shows collapsible supplementary content beneath a trigger.
   * Use when consumers should be able to reveal or hide optional
   * detail on demand.
   *
   * @example
   * <Disclosure defaultOpen>
   *   <Disclosure.Panel>Additional detail…</Disclosure.Panel>
   * </Disclosure>
   *
   * @see ./README.md
   */
  export function Disclosure(props: DisclosureProps) { … }
  ```

- **Props interface.** A short summary sentence. No `@param` lines —
  each prop documents itself.

- **Every prop.** A single-sentence description of what it does.
  - Use `@default` for defaults (including `undefined` when that is
    meaningful).
  - Cross-reference controlled / uncontrolled counterparts with
    `@see` so ts-morph surfaces the pair together.
  - When the prop accepts a literal union, document the meaning of
    each member (inline or via `@see`).

  ```ts
  export interface DisclosureProps {
    /**
     * Whether the panel is visible. Controlled mode.
     * @see defaultOpen
     * @see onOpenChange
     */
    open?: boolean;

    /**
     * Initial visibility in uncontrolled mode.
     * @default false
     */
    defaultOpen?: boolean;

    /**
     * Fired when the user toggles visibility. Fires in both modes.
     */
    onOpenChange?: (next: boolean) => void;
  }
  ```

- **Helpers, predicates, types, enums** that leave the directory: a
  one-sentence summary plus `@example` if the shape isn't obvious
  from the signature.

### What not to do

- Do not restate the signature. `/** The open prop. */` above
  `open?: boolean` is noise — delete it.
- Do not narrate the body. JSDoc describes the **contract**, not the
  implementation.
- Do not add `@param` / `@returns` to a React component's function
  signature — TypeScript already models the props and return type.
  Use the Props-interface block instead.
- Do not inline internal implementation notes. Those belong in a
  `//` comment next to the code, never in JSDoc on a public symbol
  (consumers see JSDoc in IDE tooltips and the MCP).

### What the reviewer checks

- Every public symbol has a JSDoc block (not just the component).
- Every prop has at least a summary sentence; stateful prop triplets
  cross-reference each other.
- The component has an `@example` consumers can copy.
- JSDoc has been updated when the prop changed. A prop rename or
  default change without a JSDoc update is a Critical finding under
  the Deprecations rule below.

## Controlled + uncontrolled parity

Every stateful prop must expose both modes. This mirrors the UXCore2
convention and is what consumers expect.

For a stateful prop `x`:

- `x?: T` — controlled value from the consumer.
- `defaultX?: T` — initial value in uncontrolled mode.
- `onXChange?: (next: T) => void` — change callback, fires in both modes.

The component internally uses the controlled value when `x !== undefined`,
otherwise falls back to internal state seeded with `defaultX`.

**Missing the `defaultX` counterpart on a new stateful prop is a Critical
finding for any interactive component.**

## Forwarded props

- `className` forwards to the **root** DOM element and composes with the
  component's own BEM class. Use `classnames` or a simple join; never
  replace the component's own class.
- `data-*` attributes forward to the root. This lets consumers wire their
  own instrumentation, test IDs, and behavioural hooks.
- Standard HTML attributes (`id`, `role`, `aria-*`, `title`) forward on the
  root when appropriate. When the root is a polymorphic element (`as` or a
  `Component` prop), preserve forwarding.
- **Refs forward** whenever the root is focusable or interactive. Use
  `forwardRef` or the React 19 ref-as-prop pattern, not `ref` access by
  consuming `children`.

## Prop naming

- Booleans: positive, present-tense, no `is` prefix unless it reads better.
  Prefer `open`, `disabled`, `compact` over `isOpen`, `isDisabled`,
  `isCompact`. (`disabled` matches native HTML.)
- Event handlers: `onXChange`, `onXCommit`, `onXDismiss`. Never `onChangeX`.
- Visual intent: `intent` (matches UXCore2). Not `variant` or `colour`.
- Sizes: `size` with a literal union (`'sm' | 'md' | 'lg'`). Match UXCore2's
  naming.
- Polymorphism: `as` (an element name) or `Component` (a component type),
  consistent with UXCore2's `<box.section>` pattern.

## Peer dependencies

All `@ux/*` primitives stay in `peerDependencies` with the range
`^2400.0.0 || ^2500.0.0`. This keeps the library compatible with both
supported UXCore2 majors and the upcoming Antares transition.

- Moving a `@ux/*` package from `peerDependencies` to `dependencies` —
  Critical.
- Narrowing the range (e.g. dropping `^2400`) — Critical unless the PR
  follows [`SKILL.md`](../SKILL.md) → Escalation path (a `## Risk
  surface` section in the PR description and a senior-reviewer
  sign-off).
- Adding a new `@ux/*` peer — Important; it must use the same range and the
  component must declare why the peer is needed.

`react` and `react-dom` peers stay at `^18`. Bumping to 19 is a
risk-surface escalation (see [`SKILL.md`](../SKILL.md) → Escalation
path), not a drive-by.

## Deprecations

Renaming a prop is a contract change. The supported path is:

1. Add the new prop name.
2. Accept the old name with a runtime `console.warn` (once per process) in
   dev mode only.
3. Update `README.md` and stories to use the new name.
4. Document the deprecation in the component's `README.md` (under a
   `## Deprecations` H2) and in the PR description `## Risk surface`
   section so consumers see it coming.
5. Remove the old name in the next major.

A rename without a deprecation path is a Critical finding.

## Release impact / semver mapping

Use the API rules above to choose the Changesets bump:

- **major**
  - Removing a public prop/type/export.
  - Renaming a public prop/type/export in the same PR that removes the old
    spelling.
  - Narrowing peer compatibility (for example dropping one supported
    UXCore2 major).
  - Bumping `react` / `react-dom` peers in a way that forces consumer
    upgrades.
  - Changing defaults or behavior in a way consumers must actively adapt
    to.
- **minor**
  - Adding a new component surface.
  - Adding a new backwards-compatible export or prop.
  - Introducing a deprecation path where the old API still works.
  - Expanding documented capabilities without breaking existing usage.
- **patch**
  - Fixing a bug without changing the public contract.
  - Clarifying docs or Storybook examples for existing behavior.
  - Internal maintenance where the shipped API stays the same.

Examples:

- Add `PanelProps['tone']` with a default that preserves existing renders
  → `minor`.
- Deprecate `openOnMount`, add `defaultOpen`, keep both working, document
  the path → `minor`.
- Remove `openOnMount` after the deprecation window → `major`.
- Fix a focus bug in `Thinker` without changing props or exports → `patch`.

## Review red flags

- `export default …` — Critical.
- Exported component or `Props` interface with no JSDoc block — Critical.
- Exported prop, helper, or type without a JSDoc summary — Important.
- Component JSDoc without an `@example` — Important.
- JSDoc that restates the type instead of the contract (e.g.
  `/** The open prop. */` above `open?: boolean`) — Minor (ask to
  delete).
- Prop default changed without updating `@default` in JSDoc — Critical
  (silent contract change for every consumer).
- New stateful prop without `defaultX` + `onXChange` — Critical.
- `className` not forwarded to the root — Important.
- `data-*` attributes not forwarded — Important.
- Focusable root without `forwardRef` — Important.
- Prop named `isOpen` / `onChangeValue` / `variant` / `colour` when the
  rest of the codebase uses `open` / `onValueChange` / `intent` — Minor
  (ask to rename for consistency).
- Peer-dep range narrowed or widened without justification — Critical.
- Rename without deprecation path — Critical.
- New exports at the top level that should be internal — Important.
