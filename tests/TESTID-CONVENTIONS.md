# Test ID & Locator Conventions

## data-testid naming

Format: `<area>-<element>` in kebab-case.

| Component area | Examples |
|---|---|
| Header | `header-tab-edit`, `header-refresh-button` |
| Domain panel | `domain-row-example.com`, `domain-dns-instructions` |
| Media | `media-slots-empty-state`, `media-panel-back-button` |
| Chat | `chat-toolbar-tab-media`, `chat-input-textarea` |
| Homepage | `homepage-prompt-submit` |

## Locator rules

**Use `getByTestId()`** for stable anchoring. Never match visible i18n text with `getByRole({ name: /translated string/ })` — translations change per locale (the `de-DE-smoke` Playwright project exists to catch exactly this).

**`.first()` / `.last()` require a trailing comment** explaining why there's more than one:

```typescript
page.getByTestId(`domain-row-${TARGET_DOMAIN}`).first(); // first() — test creates one domain
```

**Avoid structural CSS** — `data-slot`, `data-state`, `.ux-*`, `.airo-*` are library internals that change without notice.

**Avoid `page.locator('div')`** — DOM-structural fragility; always scope to a testid or role.

**Avoid `waitForTimeout`** — use `expect(async () => ...).toPass(...)` or Playwright's built-in condition waits. See `submitHomepage` / `waitForChatInput` in `tests/helpers/ui.ts` for the pattern.

## ESLint

`tests/eslint.config.js` flags violations as `warn`. Burn down warnings, then flip to `error` (tracked in AIROBUILD-3381).
