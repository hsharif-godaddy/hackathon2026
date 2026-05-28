# AgentMessage

Chat-surface render for agent-authored text. `AgentMessage` accepts markdown
as a string and renders it through a hardened `remark` / `rehype` pipeline
mapped onto UXCore2 typography (`@ux/text`), so every AI turn matches the
product's theme and respects its feedback intents.

```tsx
import { AgentMessage } from '@airo-ux/pattern-library/chat/agent-message';
import '@airo-ux/pattern-library/chat/agent-message/styles';
// Syntax highlighting for fenced code blocks. Consumers that never render
// code blocks can omit this import; the block still renders, just without
// Prism token colors.
import '@ux/code/styles';

export function Example({ reply }: { reply: string }) {
  return <AgentMessage>{reply}</AgentMessage>;
}
```

## When to use

- Render the text response from an AI agent inside a chat thread.
- Display streaming agent output where new tokens should be announced to
  assistive technology without re-reading the full response each tick.
- Keep rich formatting (bullet lists, inline code, links) without letting
  model output smuggle unsafe HTML into the product.

## When not to use

- Plain-text status strings or single-line prompts. Use `@ux/text` directly.
- Non-text agent output such as tool calls, citations, forms, or rich media.
  Build a purpose-specific component (e.g. `ChoiceList`) and compose it into
  the chat thread alongside `AgentMessage`.
- User-authored messages. Use `UserMessage` — it is a visually distinct,
  right-aligned chat bubble and does not render markdown by default.

## Accessibility

`AgentMessage` is a polite live region. Each instance renders as
`role="article"` with `aria-live="polite"` and `aria-atomic="false"`, so
streaming tokens are announced incrementally rather than re-reading the
full message on every tick.

- The default accessible name is `"Assistant response"`. Localize via
  `ariaLabel`, or pass a native `aria-label` attribute for compatibility.
- Links expand to native anchors. When the model authors `target="_blank"`
  the component injects `rel="noopener noreferrer"` to close the
  reverse-tabnabbing hole.
- Focus styles on links use the theme's focus intent — keyboard users see
  a visible ring on every link.
- Logical CSS properties are used throughout, so the block flows correctly
  in LTR and RTL layouts without direction-specific overrides.
- Lists keep the browser-native marker so iOS VoiceOver continues to
  announce list item counts.

## Supported markdown

`AgentMessage` ships with GitHub-flavored markdown (`remark-gfm`) and
renders the following node types through UXCore2 typography:

| Markdown | Rendered as |
| --- | --- |
| `p` | `text.p` (`as="paragraph"`) |
| `h1` / `h2` / `h3` | `text.hN` (`as="title"`, `size` 2 / 1 / 0) |
| `strong` | `text.strong` |
| `em` | `<em>` |
| `a` | `<a>` with safe `rel` on new-tab links |
| `ul` / `ol` / `li` | Native lists (browser marker preserved) |
| `blockquote` | `<blockquote>` with an inline-start accent border |
| inline `code` | `<code>` with a subtle surface |
| fenced `pre > code` | `@ux/code` with Prism.JS syntax highlighting |
| `hr` | `<hr>` with a subtle rule |
| `br` | `<br>` |

Every other tag — including inline HTML, script tags, event handlers, and
style attributes — is stripped by `rehype-sanitize` before render.

## Security

The sanitization step lives **inside** the component, not behind a consumer
hook. Every instance enforces the same allow-list of tags, URL schemes, and
attribute shapes, so agent output cannot smuggle scripts, event handlers,
opaque CSS, or unsafe links into the product:

- Only `http`, `https`, and `mailto` URL schemes survive on `href`.
  `javascript:`, `data:`, `vbscript:`, `tel:`, and `sms:` are stripped.
- `id`, `name`, and `class` attributes on agent-authored nodes are stripped
  or namespaced so model output cannot collide with real DOM IDs.
- Inline HTML inside the markdown string is ignored (`skipHtml`), so the
  sanitize step never has to reason about mixed markdown/HTML.
- `target="_blank"` links automatically gain `rel="noopener noreferrer"`.

If you need to adjust the pipeline (e.g. to allow a custom footnote style),
extend `agentMessageSanitizeSchema` via `structuredClone` — never hand-edit
the shared object.

## Custom renderers

Pass `components` to override how a specific node type renders. The
component merges overrides on top of its own defaults, so you only need to
specify the tags you want to change. Custom renderers run only for tags
that survive sanitization.

```tsx
import { AgentMessage } from '@airo-ux/pattern-library/chat/agent-message';
import text from '@ux/text';

export function WithCustomLinks({ reply }: { reply: string }) {
  return (
    <AgentMessage
      components={{
        a: ({ children, href }) => (
          <text.a as="action" href={href} target="_blank">
            {children}
          </text.a>
        ),
      }}
    >
      {reply}
    </AgentMessage>
  );
}
```

## Syntax highlighting

Fenced code blocks route through `@ux/code`, which ships Prism.JS and
reads the `language-<name>` class the markdown fence emits
(`` ```javascript ``, `` ```bash ``, etc.). Colors for the block surface
and every Prism token flow through the theme's `uxCode.*` intents, so
code blocks automatically respect light / dark mode and any downstream
theme overrides.

- Side-effect-import `@ux/code/styles` in the consumer app to pick up the
  `.ux-code` block surface and `.token.*` colors. Without that import,
  code blocks still render correctly but have no syntax coloring.
- The default Prism bundle covers markup (HTML/XML), CSS, CLike,
  JavaScript, and a handful of close relatives. To highlight additional
  languages (`python`, `rust`, `sql`, etc.) import the matching Prism
  component once in your app entry:
  `import 'prismjs/components/prism-python';`. Unknown languages render
  as plain monospace text — Prism no-ops when it has no grammar.
- The sanitize schema only keeps class tokens matching
  `^language-[\w+#-]+$` on `<code>`. Any other class the model emits
  through the fence tag (including attempts to spoof our own BEM
  classes) is stripped before Prism runs.

## Gotchas

- Always side-effect-import the styles subpath:
  `import '@airo-ux/pattern-library/chat/agent-message/styles'`. For syntax
  highlighting of fenced code blocks, also
  `import '@ux/code/styles'`.
- UXCore2 packages such as `@ux/text` and `@ux/code` are peer
  dependencies. Install compatible majors (`^2400 || ^2500`) in the
  consumer app.
- `react-markdown`, `rehype-sanitize`, and `remark-gfm` ship as runtime
  dependencies because agent output is never trusted — consumers must not
  swap in their own renderer without keeping the sanitize step intact.
- For streaming content, keep appending to the markdown string rather than
  remounting with a brand-new instance. The live region announces
  incremental additions; remounting resets the accumulated context.
- `AgentMessage` emits block-level output. Place it directly inside the
  chat thread flow — do not wrap it in a `<p>` or a flex container that
  forces `inline` display.
