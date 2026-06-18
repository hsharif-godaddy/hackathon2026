# Design

## Source of truth
- Status: Approved
- Last refreshed: 2026-06-04
- Primary product surfaces: Airo Builder develop settings menu, Display Ads settings panel, agents app-scoped settings API, publish delivery into generated v8 apps.
- Evidence reviewed: `AIROBUILD-1711`; `app/CLAUDE.md`; `agents/CLAUDE.md`; `docs/gd-charter/systems/guidelines.md`; `app/src/app/[market]/develop/components/settings/SettingsView.tsx`; `app/src/app/[market]/develop/components/settings/useSettingsNavItems.tsx`; `app/src/app/[market]/develop/components/settings/SettingsSection.tsx`; `app/src/hooks/useSocial.ts`; `app/src/lib/agent-fetch.ts`; `agents/src/server/routes/social.ts`; `agents/src/server/routes/publish.ts`; `app-templates/v8/src/server/entry.ts`; `container-scripts/preview/sync-template-files.js`.

## Brand
- Personality: Quiet, practical, and businesslike. This is an operational settings surface for site owners, not a marketing page.
- Trust signals: Clear validation, predictable save states, explicit "next publish" behavior, and no injection of arbitrary pasted HTML.
- Avoid: Decorative layouts, ad-tech jargon without action, oversized hero styling, one-off visual patterns, and hidden publish-time side effects.

## Product goals
- Goals: Let users manually configure Google AdSense for published Airo apps; persist per-app settings in app workspace metadata; deliver the AdSense script and text files on publish; document a file-backed shape the future agent-driven flow can share.
- Non-goals: AdSense account creation, payment setup, ad placement widgets, non-AdSense ad networks, preview monetization guarantees, and agent-authored setup flows.
- Success signals: A user can paste a Google AdSense snippet, save it, configure `/ads.txt` and `/app-ads.txt`, publish, and verify the script and enabled text files on the public site.

## Personas and jobs
- Primary personas: Site owners who already have an AdSense account and an Airo app; support/engineering staff validating publish delivery.
- User jobs: Paste Google's snippet, host Google-provided verification files, disable or remove the integration, and understand that changes apply on the next publish.
- Key contexts of use: Builder settings while preparing a content site, publishing workflow, and follow-up troubleshooting after Google asks for file verification.

## Information architecture
- Primary navigation: Add a dedicated `Display Ads` item in the existing settings menu.
- Core routes/screens: `?tab=settings&settings=displayAds` renders the new Display Ads panel; agent API routes live under `/apps/:id/adsense`; published apps serve `/ads.txt` and `/app-ads.txt`.
- Content hierarchy: Script snippet first, then `ads.txt`, then `app-ads.txt`, then save status. Each text-file section owns its own enable toggle and textarea.

## Design principles
- Principle 1: Keep manual setup literal. Users paste the values Google gives them; the UI validates and preserves intent without inventing an onboarding wizard.
- Principle 2: Treat publish delivery as the contract. Saved settings are only valuable when the next publish removes or includes the exact enabled outputs.
- Tradeoffs: Store a normalized publisher ID and canonical snippet for safety instead of injecting arbitrary raw snippet HTML. Preserve text-file content while toggled off so users can re-enable without re-pasting.

## Visual language
- Color: Use UXCore intent classes and default settings panel colors only. No custom ad-themed palette.
- Typography: Match existing settings panels with compact headings, paragraph descriptions, labels, and inline helper/error text.
- Spacing/layout rhythm: Stack `SettingsSection` blocks inside a single `Box gap="lg"` container, with form controls grouped in dense but readable rows.
- Shape/radius/elevation: Reuse existing settings surfaces; no nested cards. Bordered field groups are acceptable when matching existing settings patterns.
- Motion: No custom animation beyond existing UXCore control states.
- Imagery/iconography: Use an existing UXCore icon for the nav item, with `@ux/icon/content` as the conservative default unless UX provides an ad-specific icon.

## Components
- Existing components to reuse: `SettingsSection`, `SettingsLoadingState`, `PanelSkeleton`, UXCore `Box`, `Button`, `TextInput`, `Checkbox`, `Alert`, `Growl`, and React Query hooks.
- New/changed components: `DisplayAdsPanel`, `useAdSenseSettings`, `useAdSenseSettingsForm`, settings nav item, settings enum case, and lazy panel registration.
- Variants and states: Loading, load error with retry, clean/no-settings empty form, dirty form, field validation errors, save pending, save success, save failure, disabled text-file sections, and "will apply on next publish" info.
- Token/component ownership: App UI stays in `app/`; shared validation/types stay in `packages/shared/src/adsense`; runtime delivery stays in `app-templates/v8/src/server`.

## Accessibility
- Target standard: Match existing AAB settings accessibility behavior.
- Keyboard/focus behavior: All controls reachable by keyboard; save button disabled only when no valid changes exist or save is pending; toggles have explicit labels.
- Contrast/readability: Rely on UXCore intent colors and avoid low-contrast custom styling.
- Screen-reader semantics: Textareas need labels, field errors need `errorMessage`, and the saved/error feedback should be announced through existing Alert/Growl behavior.
- Reduced motion and sensory considerations: No custom motion.

## Responsive behavior
- Supported breakpoints/devices: Existing develop settings desktop and mobile panels.
- Layout adaptations: Inputs stack on narrow widths and stay within the settings scroll container; no horizontal overflow for long snippets or text-file rows.
- Touch/hover differences: Toggles and save actions must have normal touch targets; no hover-only affordances.

## Interaction states
- Loading: Show settings skeleton or panel-level loading state while the query resolves.
- Empty: Render an editable blank form with helper copy rather than a dead empty state.
- Error: Show a retryable error panel for load failures and field-specific errors for validation failures.
- Success: Show short save feedback and reset the dirty baseline to the saved payload.
- Disabled: Disabled `ads.txt` and `app-ads.txt` sections keep their content editable only if the toggle is enabled; save can still persist disabled content if product decides to preserve drafts.
- Offline/slow network, if applicable: Keep current form values visible; save button shows pending state and blocks duplicate submits.

## Content voice
- Tone: Direct, concrete, and task-focused.
- Terminology: Use `Display Ads` in navigation and `Google AdSense` in the panel title. Use literal filenames `ads.txt` and `app-ads.txt`.
- Microcopy rules: Say "Changes apply on your next publish" near the save action. Validation messages should name the exact problem: missing publisher ID, unexpected script domain, file content too large, or enabled file content empty.

## Implementation constraints
- Framework/styling system: Next.js App Router plus UXCore in `app/`; Express and workspace APIs in `agents/`; generated v8 runtime uses Express, Vite SSR, React, and Tailwind/shadcn conventions.
- Design-token constraints: Do not use raw Tailwind colors in app UI; use UXCore intent classes and existing settings layout.
- Performance constraints: Lazy-load the panel like other settings panels; do not add heavy dependencies; do not inject raw third-party script text beyond the canonical AdSense loader.
- Compatibility constraints: Add template sync hashes for touched v8 files; create `.airo/adsense.json` lazily on save; publish must generate `dist/airo-adsense.json` because local v8 preview and publish containers do not share `/app`; PaaS route access remains denied unless product scope changes.
- Test/screenshot expectations: Unit/integration tests for shared validation, file-backed agents route/service, publish manifest generation, app hooks/panel/nav, v8 server helpers/routes, and template sync hash behavior. E2E selector impact must be checked because settings menu test IDs are referenced in `tests/e2e/` and `tests/regression/`.

## Pre-implementation decision gate
- Status: Cleared on 2026-06-04.
- Owner/date: AIROBUILD-1711 assignee (`acypert@godaddy.com`) approved the file-backed contract after local preview/publish container inspection and external Claude review.
- API shape: `GET /apps/:id/adsense` and `PUT /apps/:id/adsense` are the manual and future agent-facing app-scoped contract.
- Authoring state: `.airo/adsense.json` is the only durable AdSense authoring state. The API creates `.airo/` lazily if it is absent, reads missing or malformed files as disabled settings, and writes canonical JSON only.
- Publish artifact: publish validates `.airo/adsense.json` again and generates `dist/airo-adsense.json` for v8 runtime delivery. `dist/airo-adsense.json` is generated output, not source of truth.
- Runtime delivery: v8 `entry.ts` reads the generated runtime artifact once at startup, regenerates the script from canonical fields, appends it to SSR `result.head`, and serves `/ads.txt` plus `/app-ads.txt`.
- Preview behavior: preview can save settings but must not inject AdSense.
- Future agent path: agent-driven setup must write through the same API or the same file service and reuse shared validation.
- Delivery proof: Confirm publish/runtime feasibility with a thin `.airo/adsense.json` fixture -> `dist/airo-adsense.json` -> dist archive -> published head/text-route proof before building the settings UI.

## Open questions
- [ ] UX owner / panel IA / Confirm final nav label: `Display Ads` vs `AdSense`.
- [x] Product owner / preview behavior / AdSense delivery is publish-only; preview saves settings but does not inject the script.
- [ ] Publishing owner / cache policy / Confirm desired cache headers for `/ads.txt` and `/app-ads.txt` on production.
