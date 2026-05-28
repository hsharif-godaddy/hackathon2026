# Business Logic

Components in this library must stay re-usable and portable. They do not
know about product workflows, auth, routing, feature flags, or remote data.
Data comes in via props; events go out via callbacks.

If a PR adds any of the patterns below inside `src/<area>/<name>/`, flag
it as Critical unless the author has followed
[`SKILL.md`](../SKILL.md) → Escalation path with a `## Risk surface`
section in the PR description explaining why the component genuinely
cannot stay portable.

## Blocked patterns

### Network calls

No `fetch`, no `axios`, no `XMLHttpRequest`, no WebSockets opened inside a
component. Streaming chat components accept a stream/iterator as a prop and
render it; they do not open the connection themselves.

Bad:

```tsx
export function Transcript() {
  useEffect(() => {
    fetch('/api/stream').then(…); // Critical — component opens its own connection
  }, []);
}
```

Good:

```tsx
export function Transcript({ stream }: { stream: AsyncIterable<string> }) {
  // component consumes the stream, doesn't open it
}
```

### Environment variables and configuration

No `process.env.*`, no `import.meta.env.*`, no global config reads. A
component that needs a value takes it as a prop.

### Feature flags

No imports of `@godaddy/experiments`, no conditional branches keyed off a
remote feature flag. If a feature is experimental, expose it as a prop the
consumer toggles.

### Routing

No `useNavigate`, no `<Link>` from `react-router` / `next/link` / similar.
Navigation is a consumer concern. Components expose:

- `href` prop + `onClick` event, so the consumer can decide whether the
action is a navigation or a callback.
- `as` prop or `Component` prop, so the consumer can plug in their own
`<Link>` implementation.

Bad:

```tsx
import { Link } from 'react-router-dom'; // Critical
```

Good:

```tsx
export interface MessageBubbleProps {
  href?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  as?: ElementType;
}
```

### Product strings and i18n

Every user-visible string must be consumer-configurable. Generic,
re-usable fallback copy is allowed when it keeps the primitive usable
out of the box and the consumer can override it with a prop. Product-
or workflow-specific strings — labels, instructions, error messages,
CTAs, empty-state copy, `aria-label`s, `placeholder`s — must still
arrive as props. The component does not own a message catalog, does not
call a translation function, and does not import any i18n library.

This includes `aria-label`s and similar accessibility copy: a generic
default is fine when it is re-usable and overridable; it does not need
to be a required prop.

i18n is a consumer concern. The app may use `react-intl`, `@lingui/*`,
`next-intl`, `@formatjs/*`, `i18next`, the native `Intl.*` APIs, a
hand-rolled message map, or no i18n layer at all. Choosing for them —
by importing one of those libraries in this package — forces the
choice on every downstream team and couples the primitive to a
specific runtime.

Bad:

```tsx
import { FormattedMessage } from 'react-intl'; // Critical — i18n lib in a primitive
export function Banner() {
  return <FormattedMessage id="airo.banner.title" defaultMessage="Heads up" />;
}
```

```tsx
<button>Upgrade to Pro</button> // Critical — product string baked in
```

Good — the component takes the already-translated string as a prop:

```tsx
export interface BannerProps {
  /** Heading copy shown at the top of the banner. */
  title: string;
  /** Optional supporting copy below the title. */
  description?: string;
}

export function Banner({ title, description }: BannerProps) {
  return (
    <>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </>
  );
}
```

Also good — a generic default stays overridable:

```tsx
const DEFAULT_SHOW_LABEL = 'Show details';
const DEFAULT_HIDE_LABEL = 'Hide details';

export interface DisclosureProps {
  showLabel?: string;
  hideLabel?: string;
  open: boolean;
}

export function Disclosure({
  showLabel = DEFAULT_SHOW_LABEL,
  hideLabel = DEFAULT_HIDE_LABEL,
  open,
}: DisclosureProps) {
  return <button>{open ? hideLabel : showLabel}</button>;
}
```

The consumer wires their own i18n layer at the call site:

```tsx
// Consumer app (outside this library)
import { useIntl } from 'react-intl'; // or Lingui, next-intl, or nothing at all
const intl = useIntl();
<Banner
  title={intl.formatMessage({ id: 'dashboard.banner.title' })}
  description={intl.formatMessage({ id: 'dashboard.banner.description' })}
/>;
```

Strings that happen to read as English in a default locale are not
automatically disallowed. Generic labels such as "OK", "Cancel",
"Close", "Required", and "Loading…" may ship as defaults only when they
are broadly re-usable and overridable. If the consumer cannot replace
them, or if the wording is product- or workflow-specific, it is still a
Critical finding.

### Copy that does live in this repo

In addition to any generic runtime defaults, this repository still
produces copy that ships in front of humans:

- README narrative and prose (fed into the MCP codex).
- Storybook story labels, arg defaults, and example JSX text.
- JSDoc `@example` blocks on public exports.
- Test fixture strings when the exact wording is the subject of the
  assertion.

That copy must follow GoDaddy's content conventions — voice and tone,
capitalisation, punctuation, CTA shape, date/number formatting — so
the MCP and Storybook don't teach downstream teams bad habits. The
canonical source is the **GoDaddy UX Content Design Playbook**
(`ux-content-guidelines` skill, at
[`../../ux-content-guidelines/SKILL.md`](../../ux-content-guidelines/SKILL.md)).
Reviewers should invoke it whenever the PR adds or changes copy in
any of the four surfaces above, or when a prop's JSDoc prescribes
wording (e.g. "should be sentence case, action-oriented, one word
where possible"). Consumers are bound by whatever content rules their
own org sets — but the examples and documentation we publish here
should always read as on-brand GoDaddy copy.

### What about native `Intl.*` APIs?

Calling `Intl.DateTimeFormat`, `Intl.NumberFormat`, or `Intl.Collator`
inside a component **is** allowed — they are built into the runtime,
not a library dependency. But they must operate on consumer-provided
data and a consumer-provided `locale`:

```tsx
export interface PriceTagProps {
  /** Numeric amount. */
  value: number;
  /** ISO 4217 currency code, e.g. "USD". */
  currency: string;
  /** BCP-47 locale, e.g. "en-US". Never inferred from globals. */
  locale: string;
}

export function PriceTag({ value, currency, locale }: PriceTagProps) {
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(value);
  return <span>{formatted}</span>;
}
```

What is not allowed inside a component:

- Reading the locale from `navigator.language`,
  `document.documentElement.lang`, or any other global. That is the
  same coupling as `fetch` — it ties the primitive to a browser
  environment the consumer did not opt into.
- Maintaining a hardcoded locale default like `locale = 'en-US'`. If
  the prop is optional, `undefined` defers to the platform's own
  `Intl.*` default; the component does not invent one.
- Hardcoded message strings inside format options (e.g. a literal
  unit name) — that is still a product string and must be a prop.

### Analytics / tracking

No `window.ga`, no `dataLayer.push`, no calls into product-specific tracking
SDKs. Expose events as callbacks; the consumer wires them to analytics.

### Storage

No `localStorage`, no `sessionStorage`, no `IndexedDB` inside a component.
State comes in as props; persistence is a consumer concern.

### Module-level side effects

No code outside function/class bodies that mutates anything global. No
`window.foo = …`, no `document.head.append(...)` at import time. The only
module-level side effect allowed is exporting types and the component
itself.

## Allowed

- **Pure presentation state**: `useState`, `useReducer` for open/closed,
active tab, hover state, etc.
- **Derived data**: `useMemo` for expensive transforms of the props the
consumer already gave you.
- **Keyboard/a11y wiring**: `useRef`, `useLayoutEffect` for focus
management, ARIA live regions, roving tabindex.
- **Controlled + uncontrolled parity helpers**: internal state that mirrors
a controlled prop.

## Review red flags

- `fetch(` / `axios(` / `new WebSocket(` inside `src/` — Critical.
- `process.env.` / `import.meta.env.` in component source — Critical.
- `react-router`, `next/router`, `next/link`, `@reach/router` imports —
Critical.
- Any i18n library imported inside `src/` (`react-intl`, `@lingui/*`,
  `next-intl`, `@formatjs/*`, `i18next`, `react-i18next`, and
  similar) — Critical.
- Hardcoded product- or workflow-specific English literal, or any
  non-overridable runtime string, in JSX or passed to `aria-*` /
  `placeholder` / `title` — Critical.
- `navigator.language` / `document.documentElement.lang` / any global
  locale lookup inside `src/` — Critical.
- Hardcoded locale fallback (e.g. `locale = 'en-US'`) inside a
  component — Important (ask to drop the default so `Intl.*` defers
  to the platform).
- `localStorage` / `sessionStorage` / `IndexedDB` references — Critical.
- Module-level side effects outside of type exports — Critical.
- Direct calls into GoDaddy internal SDKs (`@godaddy/experiments`, auth
libs, tracking SDKs) — Critical.

