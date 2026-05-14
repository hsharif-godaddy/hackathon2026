# Brand/Logo Flow - EID Instrumentation

Event tracking for the logo-designer brand flow. All events use the CSP/FullStory
pipeline (`window._expDataLayer`) and are queryable in ClickHouse C1 analytics.

## Naming Convention

All brand events follow `develop.brand.{widget}` → final wire format:
`appbuilder.develop.brand.{widget}.{click|impression}`

Query all brand events: `eid LIKE 'appbuilder.develop.brand.%'`

## Custom Properties

Every brand event includes:

| Property | Source | Notes |
| --- | --- | --- |
| `appId` | Auto-merged by `setInstrumentationAppId()` | Always present on develop page |
| `conversationId` | `getConversationIdFromCookie(appId)` | WebSocket/SSE session ID |
| `customerId` | `useAuth().getUserInfo().customerId` | GoDaddy customer ID |
| `flow` | Hardcoded `'logo-designer'` | Distinguishes from future `site-builder` path |

## Events

| EID | Type | When (user action) |
| --- | --- | --- |
| `develop.brand.view` | impression | User lands on `/develop/{id}` with `template=logo-designer` and the brand panel appears |
| `develop.brand.logo_view` | impression | Logo images render in the brand panel after the agent finishes generating them |
| `develop.brand.book_view` | impression | Brand panel is fully populated — logo, colors, and typography all visible |
| `develop.brand.identity_set` | impression | Agent sets the brand identity (name, personality, voice, audience) in chat |
| `develop.brand.colors_set` | impression | Agent sets the color palette in chat |
| `develop.brand.fonts_set` | impression | Agent sets the typography/fonts in chat |
| `develop.brand.logo_edit` | impression | Agent finishes editing a logo and new variations appear |
| `develop.brand.logo_select` | click | User clicks a specific logo thumbnail in the logo grid in chat |
| `develop.brand.logo_download_light` | click | User clicks "DOWNLOAD PNG" on the light-background logo in the brand panel |
| `develop.brand.logo_download_dark` | click | User clicks "DOWNLOAD PNG" on the dark-background logo in the brand panel |
| `develop.brand.mockup_download` | click | User clicks "Download Mockup" on the brand applications mockup in the brand panel |
| `develop.brand.logo_set` | click | User clicks "Set as Logo" button in chat (only visible when embedded in parent iframe) |

## Funnel

```
develop.brand.view
  → develop.brand.identity_set
  → develop.brand.colors_set / develop.brand.fonts_set
  → develop.brand.logo_view (logo generated)
  → develop.brand.logo_select (user picks from grid)
  → develop.brand.logo_set (committed)
```

Side funnels: downloads, edits.

## Transport Coverage

Tool-result-driven events fire from `hooks/shared/toolSideEffects.ts` which is
shared by both WebSocket and SSE transports. UI click events fire from React
components regardless of transport.

## Future: Site-Builder Flow

When the general website-creation flow instruments logo events, the same EIDs
fire with `flow: 'site-builder'`. Slice analytics by the `flow` custom property
to separate the two paths.
