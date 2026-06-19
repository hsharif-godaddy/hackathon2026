'use client'

import { useParams } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import Alert from '@ux/alert'
import Box from '@ux/box'
import Button from '@ux/button'
import Users3Icon from '@ux/icon/users3'
import Spinner from '@ux/spinner'

import PanelSkeleton from '@/app/[market]/develop/components/PanelSkeleton'
import { ComponentLoader } from '@/app/[market]/develop/components/paywall/cdsLoader'
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection'
import { ChatTab, SettingsSection as SettingsSectionEnum } from '@/app/[market]/develop/components/types'
import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/hooks/useAuth'
import { useGasketData } from '@/hooks/useGasketData'
import { useSwitchboard } from '@/hooks/useSwitchboard'
import { useTranslations } from '@/hooks/useTranslations'
import { AUTHZ_FGA_RELATIONS } from '@/lib/authz-fga/relations'
import { triggerCollaboratorReconcile } from '@/lib/mgmt-airo/trigger-collaborator-reconcile'
import { logger } from '@/lib/request-context'
import { useSiteStore } from '@/stores/useSiteStore'
import { getRootDomain } from '@/utils/getRootDomain'

// CDS ComponentLoader treats LoadingComponent as a component type and renders
// it as <LoadingComponent />. Passing a JSX element (<Spinner />) makes React
// throw "Element type is invalid", which the CDS loader catches and silently
// falls back — manifesting as the mock UI rendering instead of the real
// component. Pass a function component instead.
function SpinnerLoader() {
  // The CDS loader renders this INSIDE the .cds-team-portal container, which is
  // already position:fixed and inset to the Share access content area. So center
  // within that container with absolute inset-0 — a viewport-fixed wrapper with
  // --sa-* vars raced first paint (vars unset) and pushed the spinner off to the
  // right. Sized to match the bundle's own in-panel spinner that shows in the
  // next load phase, so the two phases look like one steady, centered spinner.
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Spinner size="md" />
    </div>
  )
}

// The multiusersEsm permission selector and role definitions are keyed by the
// venture FGA *relation* names (e.g. `airo_app_build`), NOT an AAB-specific
// namespace. The bundle validates `permissionsToInclude` against the venture's
// real FGA relations and silently drops unknown strings — so the old
// `aab:app:*` values left the permission selector empty and saved roles with
// `permissions[].relations: []` (confirmed via GET /v2/roles). Sourced from
// AUTHZ_FGA_RELATIONS so this stays in lockstep with BFF gating.
const AAB_TEAM_PERMISSION_KEYS = [
  AUTHZ_FGA_RELATIONS.canBuild,         // airo_app_build
  AUTHZ_FGA_RELATIONS.canPublish,       // airo_app_publish
  AUTHZ_FGA_RELATIONS.canDownload,      // airo_app_download
  AUTHZ_FGA_RELATIONS.canManageSecrets, // airo_app_manage_secrets
  AUTHZ_FGA_RELATIONS.canManageDomains, // airo_app_manage_domains
  AUTHZ_FGA_RELATIONS.canManageMembers, // user_invite
  AUTHZ_FGA_RELATIONS.canDelete,        // admin
  AUTHZ_FGA_RELATIONS.canTransfer,      // owner
  AUTHZ_FGA_RELATIONS.canViewDb,        // airo_app_view_db
  AUTHZ_FGA_RELATIONS.canEditDb,        // airo_app_edit_db
] as const

export default function TeamPanel() {
  const t = useTranslations()
  const appId = useAppIdFromParams()
  const params = useParams<{ market?: string; id?: string }>()
  const market = typeof params.market === 'string' ? params.market : 'en-US'
  const routeAppId = typeof params.id === 'string' ? params.id : appId
  const gasketData = useGasketData()
  const { getUserInfo } = useAuth()
  const multiUser = useSwitchboard('aab-multi-user')
  const teamLegacy = useSwitchboard('appbuilder-settings-team')
  const rootDomain = getRootDomain() || 'godaddy.com'
  const delegationUrl = `https://sso.${rootDomain}/access`

  const site = useSiteStore((state) => {
    if (!appId) {
      return null
    }
    return state.getSite(appId)
  })
  const isSiteLoading = useSiteStore((state) => {
    if (!appId) {
      return false
    }
    return state.loading[appId] ?? false
  })

  const fetchSite = useSiteStore((state) => state.fetchSite)

  const ventureId = site?.team_venture_id
  const rawCustomerId = getUserInfo().customerId || site?.owner_customer_id
  const customerId = typeof rawCustomerId === 'string' ? rawCustomerId : undefined

  // When the flag is on but venture isn't provisioned yet, refetch the site to
  // pick up the team_venture_id that ensureAppTeamVenture wrote (via agent-token).
  // Polls up to 5 times at 3s intervals to handle the race where provisioning
  // just completed but the store has a stale site object from page load.
  useEffect(function refetchUntilVenture() {
    if (multiUser !== true || ventureId || !appId) {
      return undefined
    }
    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 5
    const INTERVAL_MS = 3000

    const poll = async () => {
      if (cancelled || attempts >= MAX_ATTEMPTS) return
      attempts += 1
      const refreshed = await fetchSite(appId, true, true)
      if (cancelled) return
      if (refreshed?.team_venture_id) return
      if (attempts < MAX_ATTEMPTS) {
        timer = window.setTimeout(poll, INTERVAL_MS)
      }
    }

    let timer = window.setTimeout(poll, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [multiUser, ventureId, appId, fetchSite])

  // Remount counter — bump to force a fresh MemoryRouter (resets bundle's
  // internal route state to the seeded `/users` entry). Used by the
  // ErrorBoundary's "Try again" path and the auto-reset observer below.
  const [resetKey, setResetKey] = useState(0)
  // Auto-reset usage counter capped to prevent infinite loops if the bundle
  // is permanently broken. Reset back to 0 after a successful render.
  const autoResetCountRef = useRef(0)
  const MAX_AUTO_RESETS = 3
  const resetPanel = useCallback(() => setResetKey((k) => k + 1), [])

  // Anchor-click guard. The multiusersEsm bundle renders some links as
  // raw <a href="…"> with an onClick handler that should preventDefault and
  // do SPA navigation. If onClick fails or isn't reached for any reason
  // (e.g., target is _blank, an inner span swallows the event), the browser
  // performs the default action — which here means leaving /develop/<appId>
  // and landing on a non-existent Next.js page (white screen until refresh).
  // Intercept clicks in our wrapper and call preventDefault for any anchor
  // whose href looks like an internal multi-users path (`/users`,
  // `/invite-user`, `/user-roles`, `/add-new-user-role`, `/edit-custom-role`)
  // so the bundle's MemoryRouter handles them via JS navigation only.
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(function installAnchorGuard() {
    const node = containerRef.current
    if (!node) return
    const internalPaths = /^\/(users|invite-user|user-roles|add-new-user-role|edit-custom-role)(\/|$|\?)/
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      const anchor = target.closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (!href) return
      if (anchor.target && anchor.target !== '_self') return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (!internalPaths.test(href)) return
      event.preventDefault()
    }
    node.addEventListener('click', handler, true)
    return () => node.removeEventListener('click', handler, true)
  }, [resetKey])

  // Auto-reset on white-screen. The multiusersEsm bundle has its own
  // ErrorBoundary that suppresses some failure paths to an empty fragment
  // (observed: invite submit → /users navigation → bundle renders empty).
  // No exception bubbles up so our outer ErrorBoundary never sees it. Watch
  // the container for the "had real content → went empty" transition and
  // bump the resetKey to remount the bundle. Capped at MAX_AUTO_RESETS to
  // avoid infinite loops if the bundle is permanently broken; manual
  // "Refresh team panel" button below the bundle is the final fallback.
  useEffect(function autoResetOnEmpty() {
    const node = containerRef.current
    if (!node) return undefined
    let pendingResetTimer: ReturnType<typeof setTimeout> | null = null
    let everHadContent = false

    const isEmpty = (): boolean => {
      const text = node.textContent?.trim() ?? ''
      // Empty wrapper is roughly `<div><div class="..."></div></div>` with no
      // text and no testid'd descendants.
      return text.length === 0 && node.querySelectorAll('[data-testid]').length === 0
    }

    const observer = new MutationObserver(() => {
      if (!everHadContent && !isEmpty()) {
        everHadContent = true
        autoResetCountRef.current = 0 // successful render — reset the counter
        return
      }
      if (everHadContent && isEmpty()) {
        if (pendingResetTimer) return
        if (autoResetCountRef.current >= MAX_AUTO_RESETS) {
          logger.warn('team-panel.auto-reset.max-reached', { appId: routeAppId })
          return
        }
        // Debounce — give the bundle a moment to finish a transient empty
        // state (e.g., during navigation) before remounting.
        pendingResetTimer = setTimeout(() => {
          pendingResetTimer = null
          if (!isEmpty()) return
          autoResetCountRef.current += 1
          logger.info('team-panel.auto-reset.fired', {
            appId: routeAppId,
            attempt: autoResetCountRef.current,
          })
          setResetKey((k) => k + 1)
        }, 250)
      } else if (pendingResetTimer && !isEmpty()) {
        clearTimeout(pendingResetTimer)
        pendingResetTimer = null
      }
    })

    observer.observe(node, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      if (pendingResetTimer) clearTimeout(pendingResetTimer)
    }
  }, [resetKey, routeAppId])

  // Reconcile the collaborator table shortly after the team UI settles. The
  // multiusersEsm bundle writes invites/role changes straight to FGA and gives us
  // no callback, so we watch its DOM for changes (an invite landing, a role edit,
  // the user list updating) and fire a debounced, owner-authorized reconcile.
  // The debounce both coalesces the bundle's render churn into a single call and
  // gives the bundle's FGA write time to propagate before we read members back.
  // This is what makes an invited user appear without waiting for a panel close.
  // Idempotent + grant-only server-side, so over-firing is harmless.
  useEffect(function reconcileOnTeamChange() {
    const node = containerRef.current
    if (!node || !routeAppId) return undefined
    const RECONCILE_DEBOUNCE_MS = 2500
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        triggerCollaboratorReconcile(routeAppId)
      }, RECONCILE_DEBOUNCE_MS)
    })
    observer.observe(node, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [resetKey, routeAppId])

  useEffect(function teamPanelDiagnostics() {
    if (!appId || !routeAppId) {
      return
    }
    const cds = gasketData?.cds as { componentTypes?: string[] } | undefined
    const types = cds?.componentTypes
    const branch =
      multiUser === true && ventureId && customerId
        ? 'cds_multiusers'
        : multiUser === true && !ventureId
          ? 'missing_venture'
          : teamLegacy === true
            ? 'legacy_sso'
            : multiUser === false && teamLegacy === false
              ? 'flags_off'
              : 'loading_or_unknown'
    logger.info('develop.team.panel', {
      appId: routeAppId,
      branch,
      multiUser,
      teamLegacy,
      hasVentureId: Boolean(ventureId),
      hasCustomerId: Boolean(customerId),
      isSiteLoading,
      cdsIncludesMultiusersEsm: Array.isArray(types) && types.includes('multiusersEsm'),
    })
  }, [
    appId,
    routeAppId,
    multiUser,
    teamLegacy,
    ventureId,
    customerId,
    isSiteLoading,
    gasketData,
  ])

  if (!appId || !routeAppId) {
    return null
  }

  if (isSiteLoading || multiUser === undefined || teamLegacy === undefined) {
    return <PanelSkeleton panelType={ChatTab.SETTINGS} settingsSection={SettingsSectionEnum.TEAM} />
  }

  if (multiUser === true && ventureId && customerId) {
    const routePrefix = `/${market}/develop/${routeAppId}/settings/team`
    const ErrorFallbackWithReset = (
      <Box orientation="vertical" gap="md">
        <Alert emphasis="critical">
          {t('builder_team_load_error', undefined, 'Team management could not be loaded. Try again or use Manage access below.')}
        </Alert>
        <Button
          design="secondary"
          size="sm"
          text="Try again"
          onClick={resetPanel}
        />
      </Box>
    )
    return (
      <ErrorBoundary fallback={ErrorFallbackWithReset}>
        <Box ref={containerRef} className="min-h-[24rem] w-full">
          {/* The multiusersEsm bundle has flat absolute Routes (/users,
              /invite-user, …) but its MultiUsersContext also exposes
              `prepareRoute(p) = routePrefix + p` and uses it INSIDE the
              navigateToRoute hook. So if we pass our `/<market>/.../team`
              prefix as the `routePrefix` PROP, every click calls
              `navigate('/<market>/.../team/invite-user')` — which doesn't
              match `<Route path="/invite-user">` and renders nothing.
              Set the prop to "" so prepareRoute is a no-op, then handle
              the URL prefix at the host's Router level via `basename`:
              react-router strips basename before route matching, so
              `navigate('/invite-user')` resolves to `<Route path="/invite-user">`
              correctly. initialEntries lands the first render on /users
              (the bundle's index route also handles "/" → user list, but
              seeding /users avoids any flicker). The `key={resetKey}` lets
              us force-remount the entire bundle if it gets stuck (e.g.,
              after an invite where the optimistic cache update breaks
              rendering). */}
          <MemoryRouter
            key={resetKey}
            basename={routePrefix}
            initialEntries={[`${routePrefix}/users`]}
          >
            <ComponentLoader
              cds={gasketData?.cds}
              customerId={customerId}
              design="ANTARES"
              loaderMode="esm"
              locale={gasketData?.intl?.locale || 'en-US'}
              //permissionsToInclude={[...AAB_TEAM_PERMISSION_KEYS]}
              resourceId={ventureId}
              resourceType="venture"
              routePrefix=""
              source="aab-team-multiusers"
              type="multiusersEsm"
              containerClassName="cds-team-portal"
              LoadingComponent={SpinnerLoader}
              renderErrorFallback={() => ErrorFallbackWithReset}
            />
          </MemoryRouter>
        </Box>
      </ErrorBoundary>
    )
  }

  if (multiUser === true && !ventureId) {
    return (
      <div className="flex items-center justify-center min-h-[12rem]">
        <Spinner size="md" />
      </div>
    )
  }

  if (teamLegacy === true) {
    return (
      <SettingsSection
        title={t('builder_settings_team_title')}
        description={t('builder_settings_team_description')}
        button={(
          <Button
            design="primary"
            size="sm"
            text={t('builder_settings_team_manage_access')}
            href={delegationUrl}
            rel="noopener noreferrer"
            icon={<Users3Icon />}
            external
          />
        )}
      />
    )
  }

  return (
    <Alert emphasis="info">
      {t('builder_team_not_enabled', undefined, 'Team settings are not enabled for this account.')}
    </Alert>
  )
}
