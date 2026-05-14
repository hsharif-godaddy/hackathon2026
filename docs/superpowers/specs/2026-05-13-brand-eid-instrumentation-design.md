# Brand/Logo EID Instrumentation Design

## Summary

Instrument EID (Event ID) tracking for the logo-designer brand flow. Currently the entire brand/logo experience has zero EID coverage. This adds 12 events covering the full funnel from entry through logo adoption.

## Flow

```
/create?template=logo-designer
  → quick app allocation (transparent to user)
  → /develop/{id} with ViewMode.BRAND
  → User sees: Chat (left) + BrandBookView panel (right)
  → Chat auto-sends initial prompt → logo-designer agent runs
  → As brand/logo data streams in, BrandBookView updates live
  → User interacts with logo grid, downloads, "Set as Logo", etc.
```

## EID Naming Convention

Format: `product.section.widget` → system prepends `appbuilder.` and appends `.{action}`

All brand/logo events use `develop.brand.*` so they can be queried with a single wildcard filter.

## Custom Properties (all events)

```typescript
{ appId, conversationId, customerId, flow: 'logo-designer' }
```

- `appId`: auto-merged by instrumentation utility via `setInstrumentationAppId()`
- `conversationId`: from WebSocket/SSE session
- `customerId`: from auth context
- `flow`: distinguishes logo-designer path from future site-builder path

## Events

| EID | Type | Trigger |
|---|---|---|
| `develop.brand.view` | impression | ViewMode switches to BRAND on develop page |
| `develop.brand.logo_view` | impression | Logo images render in BrandBookView after generation completes |
| `develop.brand.book_view` | impression | BrandBookView mounts with all brand data populated |
| `develop.brand.logo_select` | click | User clicks a logo thumbnail in the logo grid widget |
| `develop.brand.logo_download_light` | click | User clicks download on light-background logo |
| `develop.brand.logo_download_dark` | click | User clicks download on dark-background logo |
| `develop.brand.mockup_download` | click | User clicks download on the brand applications mockup |
| `develop.brand.logo_set` | click | User clicks "Set as Logo" button in chat tool renderer |
| `develop.brand.identity_set` | impression | `brandBook` tool result arrives via WebSocket/SSE |
| `develop.brand.colors_set` | impression | `colorScheme` tool result arrives via WebSocket/SSE |
| `develop.brand.fonts_set` | impression | `fontTheme` tool result arrives via WebSocket/SSE |
| `develop.brand.logo_edit` | impression | `edit_logo` tool result arrives with new variations |

## Funnel

```
develop.brand.view → develop.brand.identity_set → develop.brand.logo_view → develop.brand.logo_select → develop.brand.logo_set
```

Side funnels: downloads (`logo_download_light`, `logo_download_dark`, `mockup_download`) and edits (`logo_edit`).

## Implementation Locations

| File | Events |
|---|---|
| `app/src/app/[market]/develop/[id]/page.tsx` | `develop.brand.view` |
| `app/src/app/[market]/develop/components/preview/brand-book/index.tsx` | `develop.brand.logo_view`, `develop.brand.book_view` |
| `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx` | download clicks |
| `app/src/app/[market]/develop/components/widgets/LogoGridWidget.tsx` | `develop.brand.logo_select` |
| `app/src/app/[market]/develop/components/tool-renderers/LogoActionsToolRenderer.tsx` | `develop.brand.logo_set` |
| `app/src/hooks/shared/toolSideEffects.ts` | `develop.brand.identity_set`, `develop.brand.colors_set`, `develop.brand.fonts_set`, `develop.brand.logo_edit` |

## Transport Coverage

Both WebSocket and SSE paths are covered because tool side effects live in shared code (`hooks/shared/toolSideEffects.ts`), and UI components fire regardless of transport.

## Future Work

When the site-builder path instruments logo events, the same EIDs fire with `flow: 'site-builder'` to enable slicing by flow dimension.
