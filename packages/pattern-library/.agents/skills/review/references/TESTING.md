# Testing

This repo uses Vitest with `@testing-library/react` + `user-event` + `jsdom`.
Coverage is enforced via `vitest.config.ts`. Don't lower the threshold to
land a PR; add the missing tests.

## Coverage floor

- **80% lines**
- **75% branches**

Enforced in `vitest.config.ts`. A PR that drops the threshold to green the
build is a Critical finding regardless of how small the miss is.

## Required test cases

Every component has at minimum:

1. **Default render** — component renders with only required props, no
   throws, no console errors.
2. **Controlled ↔ uncontrolled parity** — if the component has any
   stateful prop, both modes work: controlled (`value` + `onValueChange`
   updates render) and uncontrolled (`defaultValue` updates internal
   state).
3. **Keyboard a11y** (interactive components only) — at least:
   - `Enter` and `Space` for button/toggle roles.
   - `Escape` for dismissible surfaces (dialog, popover, menu).
   - Arrow-key navigation for list/menu/tab roles.
4. **ARIA assertions** — the expected `role`, `aria-expanded`, `aria-live`,
   `aria-label`, `aria-describedby` attributes are present and correctly
   linked. `@testing-library/jest-dom` matchers make this terse.
5. **Forwarded props** — `className` appears on the root DOM element,
   `data-*` attributes forward, ref forwards if the root is focusable.

## Accessibility target

Every interactive component is expected to meet **WCAG 2.1 Level AA** at
minimum. That's the enforceable bar across the repo:

- Color contrast ≥ 4.5:1 for text, ≥ 3:1 for non-text UI (already
  satisfied by intent tokens; flagging hardcoded colours catches
  regressions).
- Full keyboard operability — see the required test cases above.
- Visible focus indicators. If you're overriding `:focus-visible`
  styling, the replacement must be at least as visible.
- Reflow at 400% zoom without loss of content or function (Storybook
  viewport addon or a jsdom-agnostic manual check in review).
- Programmatic name, role, value for every interactive element —
  asserted in the ARIA tests above.

AA is the minimum; Level AAA is a nice-to-have and never blocks merge.
Missing an AA behaviour on a **new** interactive component is Critical;
a regression on an existing component is Important.

Interactive streaming components additionally:

6. Render intermediate states (empty, loading, partial, complete).
7. Handle stream completion without leaking listeners.

## Forbidden patterns

- **No snapshot tests of `@ux/*` internal DOM.** UXCore2 markup changes
  across minors; a DOM snapshot produces false-positive diffs that block
  unrelated PRs. Snapshot only the Airo wrapper structure, and only when
  necessary — `@testing-library/react` assertions are almost always a
  better fit.
- **No tests that click `.ux-*` classes.** Use role-based or label-based
  queries (`getByRole`, `getByLabelText`).
- **No tests that mock `@ux/*` primitives.** Render the real components.
  If a primitive is too heavy to render in jsdom, the test is probably
  asserting the wrong thing.
- **No `act()` wrappers around trivial state updates.** `@testing-library`
  already wraps for you. Use `await` + user-event.
- **No time-based flakes** — use `vi.useFakeTimers()` + `vi.advanceTimers*`
  for any animation or debounce testing. Never `setTimeout` in a test.

## What belongs in `__tests__/`

- `<Name>.test.tsx` — the cases above for the main component.
- `<Name><Subpart>.test.tsx` — per-sub-part tests when the sub-part has its
  own behaviour worth isolating.
- Shared test helpers live in `src/test-utils/` or alongside the component
  if they're component-specific.

Stories are **not** tests. They feed Storybook and the MCP. If a scenario
worth testing only shows up via a story, write a matching Vitest case.

## Running tests

- Whole suite with coverage: `npm test`.
- Watch mode: `npm run test:watch`.
- One file: `npm test -- src/<area>/<name>`.
- One name: `npm test -- -t "renders indicator"`.

## Review red flags

- PR adds a new component, no `__tests__/<Name>.test.tsx` — Critical.
- PR adds a new stateful prop, no controlled+uncontrolled test —
  Critical.
- PR lowers coverage threshold in `vitest.config.ts` — Critical.
- PR adds a snapshot of `@ux/*` DOM — Important (ask for role/label-based
  assertions instead).
- PR uses `setTimeout` in a test — Minor (ask for `vi.useFakeTimers`).
- PR queries by class name (`container.querySelector('.ux-…')`) — Important.
- PR mocks `@ux/*` primitives — Important.
