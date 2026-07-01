# Upgrade Banner Preview Placement (Hivemind A/B Test)

## Context

The upgrade chat banner currently lives in the chat panel (managed by `ChatBanners.tsx` at priority 4). We want to A/B test moving it to the preview header area (above the preview iframe), matching the DomainBar pattern.

- **Control (off cohort):** chat banner for free users (existing behavior)
- **Treatment (on cohort):** preview bar for free users (new behavior)
- **Ineligible/undefined:** falls back to control (chat banner)

**Feature flag gating:** Both positions require `appbuilder-airoplus-upgrade-banner` to be ON. The experiment only determines *position* — if the feature flag is OFF, neither banner shows regardless of cohort.

**Experiment ID:** `aab-upgrade-banner-placement`

**Targeting:** Free users only (`showPaywall === true`). The `canUpgradePlan` condition is removed — Starter/Professional users no longer see the upgrade banner at all.

**Mutual exclusivity:** Free users cannot publish (publish limit is 0), so DomainBar (requires `isPublished`) and UpgradeBar never compete for the same slot.

**Trigger event:** Fire a Hivemind trigger impression only for free users so only they get bucketed into the experiment.

## Steps

### 1. Add experiment to `experiments.ts`

**File:** `app/src/config/experiments.ts`

```typescript
/** Upgrade banner placement: chat panel (off) vs preview bar (on). */
upgradeBannerPlacement: 'aab-upgrade-banner-placement',
```

No `gasket.ts` registration needed — the `airo-builder` app label pulls it in automatically.

### 2. Create reusable `PreviewBar` component

**File:** `app/src/app/[market]/develop/components/layout/PreviewBar.tsx`

Extract the shared bar UI from DomainBar:
- Props: `children`, optional `onClose`, optional `className`
- Renders: `mx-2 px-1 py-0.5 rounded-t-lg leading-none bg-ai text-intents-ux-boxHighContrast-foregroundColor flex items-center justify-between gap-2`
- Dismiss X button when `onClose` is passed

### 3. Refactor DomainBar to use `PreviewBar`

**File:** `app/src/app/[market]/develop/components/layout/DomainBar.tsx`

Replace DomainBar's raw `<div>` wrapper (lines 355-390) with `<PreviewBar onClose={handleDismiss}>`. Keep all domain logic, just swap the outer container.

### 4. Create `UpgradeBar` component

**File:** `app/src/app/[market]/develop/components/layout/UpgradeBar.tsx`

Eligibility (feature flag + experiment cohort check handled by PreviewPane parent):
- Free user only (`showPaywall === true`) — `canUpgradePlan` is NOT used
- Not dismissed today (localStorage key `airoplus_upgrade_banner_dismissed`)
- Not a shared/invited collaborator
- Paywall data loaded

Renders `<PreviewBar>` with:
- Centered message using `FormattedMessage` with existing i18n keys (`builder_airoplus_upgrade_message`, `builder_airoplus_upgrade_link`)
- Inline upgrade link that opens paywall modal
- X dismiss button (daily localStorage dismissal)
- Analytics: `preview.upgradeBanner.view`, `preview.upgradeBanner.close`, `preview.upgradeBanner.upgrade`

### 5. Render `UpgradeBar` in PreviewPane (treatment cohort only)

**File:** `app/src/app/[market]/develop/components/preview/PreviewPane.tsx`

```tsx
const upgradeBannerEnabled = useSwitchboard('appbuilder-airoplus-upgrade-banner')
const { cohort: upgradeBannerCohort } = useHivemind(EXPERIMENT_IDS.upgradeBannerPlacement)
const isUpgradeBarTreatment = upgradeBannerEnabled && upgradeBannerCohort === COHORT_ON
```

Refactor the existing wrapper div to be a single shared slot for preview banners (DomainBar and UpgradeBar are mutually exclusive):
```tsx
<div className="px-1 md:px-2">
  {isDomainBarEnabled && <DomainBar />}
  {isUpgradeBarTreatment && <UpgradeBar />}
</div>
```

This replaces the current pattern where DomainBar has its own wrapper div.

### 6. Update chat UpgradeBanner: free users only + control cohort

**File:** `app/src/app/[market]/develop/components/chat/banners/ChatBanners.tsx`

Two changes:
1. Narrow eligibility to free users only: change `isUpgradeBannerActive` from `showPaywall` to just `showPaywall` (it already uses this — but also remove the `canUpgradePlan` usage if present)
2. Add experiment gating so it only shows for control (off) cohort:

```tsx
const { cohort: upgradeBannerCohort } = useHivemind(EXPERIMENT_IDS.upgradeBannerPlacement)
const isPreviewBarTreatment = upgradeBannerCohort === COHORT_ON
```

Update `isUpgradeBannerActive` to include `&& !isPreviewBarTreatment`.

**File:** `app/src/app/[market]/develop/components/chat/banners/UpgradeBanner.tsx`

Remove `canUpgradePlan` from the render condition. Change:
```tsx
(!showPaywall && !canUpgradePlan(currentPlan))
```
to:
```tsx
!showPaywall
```

Remove unused `useSubscription`, `getPlanFromSubscription`, `canUpgradePlan` imports.

Result: chat banner shows when feature flag ON + free user + cohort is OFF/ineligible/undefined. Preview bar shows when feature flag ON + free user + cohort is ON.

### 7. Add trigger event for experiment bucketing

Fire a Hivemind trigger impression when the user is a free user (`showPaywall === true`), so only free users get bucketed into the experiment. This can be done in a shared location (e.g., a `useUpgradeBannerExperiment` hook) that both ChatBanners and PreviewPane consume, or inline where the cohort is checked. Follow the existing `usePublishButtonLabel` trigger hook pattern (`app/src/experiments/publish-button-label/usePublishButtonLabel.ts`).

### 8. Add tests

**File:** `app/src/app/[market]/develop/components/layout/UpgradeBar.test.tsx`

Cover: renders when eligible, hidden when dismissed/shared/Ultimate, dismiss persists, upgrade click opens modal, analytics.

**File:** `app/src/app/[market]/develop/components/chat/banners/ChatBanners.test.tsx`

Add test: upgrade banner hidden when cohort is `on` (treatment).

### 9. Add experiment analytics to both positions

Both banners should log the cohort in their impression/click events so we can measure:
- Impression rate per cohort
- Upgrade click rate per cohort
- Dismissal rate per cohort

## Key Files

| File | Action |
|------|--------|
| `app/src/config/experiments.ts` | Add experiment ID |
| `app/src/app/[market]/develop/components/layout/PreviewBar.tsx` | Create (reusable bar) |
| `app/src/app/[market]/develop/components/layout/UpgradeBar.tsx` | Create (treatment variant) |
| `app/src/app/[market]/develop/components/layout/UpgradeBar.test.tsx` | Create (tests) |
| `app/src/app/[market]/develop/components/layout/DomainBar.tsx` | Refactor to use PreviewBar |
| `app/src/app/[market]/develop/components/preview/PreviewPane.tsx` | Render UpgradeBar for treatment |
| `app/src/app/[market]/develop/components/chat/banners/ChatBanners.tsx` | Gate to control cohort |

## Gating Summary

| Condition | Chat Banner (control) | Preview Bar (treatment) |
|-----------|----------------------|------------------------|
| `appbuilder-airoplus-upgrade-banner` flag | Must be ON | Must be ON |
| Experiment cohort | OFF / ineligible / undefined | ON |
| Free user (`showPaywall` only) | Yes | Yes |
| Not shared/invited | Yes | Yes |
| Not dismissed today | Yes | Yes |

## Verification

1. `pnpm --filter website typecheck` — passes
2. `pnpm --filter website lint` — passes
3. `pnpm --filter website test "UpgradeBar"` — new tests pass
4. `pnpm --filter website test "DomainBar"` — existing tests still pass
5. `pnpm --filter website test "ChatBanners"` — updated tests pass
6. `pnpm --filter website build` — builds cleanly

## Post-merge: Hivemind setup

Create the experiment in Hivemind:
- Experiment ID: `aab-upgrade-banner-placement`
- App label: `airo-builder`
- Cohorts: `on` (treatment = preview bar for free users), `off` (control = chat banner for free users)
- Targeting: free users eligible for upgrade
