'use client'

import { useEffect, useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import { ButtonGroup } from '@/app/[market]/develop/components/ButtonGroup'
import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
import {
  issuesForCategory,
  type SeoAuditIssueCategory,
  splitIssuesByCategory,
} from '@/app/[market]/develop/components/widgets/seo-audit-issue-category'
import { whyForSeoAuditIssue } from '@/app/[market]/develop/components/widgets/seo-audit-issue-why'
import { useTranslations } from '@/hooks/useTranslations'
import { useIsActivelyStreaming, useIsLoading } from '@/stores/useStreamingConversationStore'

export type SeoIssueSeverity = 'critical' | 'warning' | 'info'

export type SeoAuditIssueView = {
  code: string
  label: string
  severity?: SeoIssueSeverity
}

export type SeoAuditMode = 'published' | 'preview' | 'source-only'

export type SeoPageAuditView = {
  path: string
  url?: string
  layer: 'published' | 'preview' | 'source'
  ok: boolean
  issues: SeoAuditIssueView[]
}

export type SeoStrategyView = {
  businessInfo: {
    name: string
    type?: string
    location?: string
    targetAudience?: string
  }
  targetKeywords?: string[]
  analysisGuidance: string
}

export type SeoAuditReportView = {
  appId: string
  auditedAt: string
  htmlBaseUrl?: string | null
  auditMode?: SeoAuditMode
  /** @deprecated Use htmlBaseUrl */
  publishedBaseUrl?: string | null
  routes: string[]
  pages: SeoPageAuditView[]
  summary: {
    totalPages: number
    pagesWithIssues: number
    issueCount: number
  }
  strategy?: SeoStrategyView
  schemaAeoByRoute?: Record<string, { types: string[]; fields: string[] }>
  schemaTypesByRoute?: Record<string, string[]>
}

function resolveAuditMode(report: SeoAuditReportView): SeoAuditMode {
  if (report.auditMode) return report.auditMode
  if (report.pages.some(p => p.layer === 'preview')) return 'preview'
  if (report.pages.some(p => p.layer === 'published')) return 'published'
  return 'source-only'
}

export type SeoAuditReportWidgetProps = {
  appId: string
  report: SeoAuditReportView
  offerFix?: boolean
  /** When false, report stays visible but Fix is hidden (e.g. after user sent a follow-up). */
  fixEnabled?: boolean
}

type RouteRow = {
  path: string
  issueCount: number
  seoIssueCount: number
  aeoIssueCount: number
  seoIssues: SeoAuditIssueView[]
  aeoIssues: SeoAuditIssueView[]
  entries: SeoPageAuditView[]
}

type TranslateFn = ReturnType<typeof useTranslations>

const ISSUE_TABLE_COLUMNS = 'grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2 items-center'
const ISSUE_VIEW_TOGGLE_INACTIVE = '[&[aria-checked=false]]:!bg-transparent'
const AUDIT_PURPLE_PANEL =
  'rounded-md border border-[color-mix(in_srgb,var(--color-light-purple-solid)_35%,transparent)] bg-light-purple'

function AccordionChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`h-2.5 w-2.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
        expanded ? 'rotate-180' : ''
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

function formatRoute(path: string): string {
  return path
}

function formatIssueCount(count: number, t: TranslateFn): string {
  return t(
    'builder_seo_audit_issue_count',
    { count },
    '{count, plural, one {# issue} other {# issues}}',
  )
}

function ModalRouteLabel({ path, t }: { path: string; t: TranslateFn }) {
  if (path === '/') {
    return (
      <span className="truncate font-mono text-sm text-foreground">
        <span className="font-semibold">/</span>
        <span className="font-normal text-intents-ux-feedbackHighContrastPassive-feedbackColor">
          {' '}
          ({t('builder_seo_audit_route_homepage', undefined, 'Homepage')})
        </span>
      </span>
    )
  }

  return (
    <span className="truncate font-mono text-sm font-semibold text-foreground">{path}</span>
  )
}

function IssueCountBadge({ count, t }: { count: number; t: TranslateFn }) {
  const label = formatIssueCount(count, t)
  const colorClass =
    count > 0
      ? 'text-intents-ux-feedbackHighContrastCritical-feedbackColor'
      : 'text-intents-ux-feedbackHighContrastSuccess-feedbackColor'

  return <span className={`shrink-0 text-xs font-medium ${colorClass}`}>{label}</span>
}

function mergePagesByRoute(pages: SeoPageAuditView[]): RouteRow[] {
  const byPath = new Map<string, SeoPageAuditView[]>()
  for (const page of pages) {
    const list = byPath.get(page.path) ?? []
    list.push(page)
    byPath.set(page.path, list)
  }

  return [...byPath.entries()]
    .map(([path, entries]) => {
      const issues = entries.flatMap(e => e.issues)
      const { seo, aeo } = splitIssuesByCategory(issues)
      return {
        path,
        issueCount: issues.length,
        seoIssueCount: seo.length,
        aeoIssueCount: aeo.length,
        seoIssues: seo,
        aeoIssues: aeo,
        entries,
      }
    })
    .sort((a, b) => {
      if (a.issueCount > 0 && b.issueCount === 0) return -1
      if (a.issueCount === 0 && b.issueCount > 0) return 1
      if (b.issueCount !== a.issueCount) return b.issueCount - a.issueCount
      return a.path.localeCompare(b.path)
    })
}

function getRouteIssuesForView(row: RouteRow, issueView: SeoAuditIssueCategory): SeoAuditIssueView[] {
  const seen = new Set<string>()
  const issues: SeoAuditIssueView[] = []

  for (const entry of row.entries) {
    for (const issue of issuesForCategory(entry.issues, issueView)) {
      if (!seen.has(issue.code)) {
        seen.add(issue.code)
        issues.push(issue)
      }
    }
  }

  if (issues.length > 0) {
    return issues
  }

  return issueView === 'seo' ? row.seoIssues : row.aeoIssues
}

function layerLabel(layer: SeoPageAuditView['layer'], t: TranslateFn): string {
  if (layer === 'published') {
    return t('builder_seo_audit_layer_published', undefined, 'Published site')
  }
  if (layer === 'preview') return t('builder_seo_audit_layer_preview', undefined, 'Preview')
  return t('builder_seo_audit_layer_source', undefined, 'Source code')
}

function scannedUrlHeading(auditMode: Exclude<SeoAuditMode, 'source-only'>, t: TranslateFn): string {
  if (auditMode === 'preview') {
    return t('builder_seo_audit_scanned_url_preview', undefined, 'Scanned URL (preview)')
  }
  return t('builder_seo_audit_scanned_url_published', undefined, 'Scanned URL (published)')
}

function AuditSiteSourceBanner({
  auditMode,
  htmlBaseUrl,
  t,
}: {
  auditMode: SeoAuditMode
  htmlBaseUrl?: string | null
  t: TranslateFn
}) {
  if (auditMode === 'source-only' || !htmlBaseUrl) {
    return null
  }

  return (
    <p className="m-0 flex min-w-0 items-baseline gap-1.5 text-xs leading-snug text-intents-ux-feedbackHighContrastPassive-feedbackColor">
      <span className="shrink-0 font-medium text-intents-ux-box-foregroundColor">
        {scannedUrlHeading(auditMode, t)}
      </span>
      <span className="min-w-0 truncate font-mono text-[11px]">{htmlBaseUrl}</span>
    </p>
  )
}

function auditModeBanner(auditMode: SeoAuditMode, t: TranslateFn): string {
  if (auditMode === 'published') {
    return t('builder_seo_audit_banner_published', undefined, 'HTML checks ran against your published site.')
  }
  if (auditMode === 'preview') {
    return t(
      'builder_seo_audit_banner_preview',
      undefined,
      'HTML checks ran against your preview. Publish to verify the live site.',
    )
  }
  return t(
    'builder_seo_audit_banner_source_only',
    undefined,
    'Preview and publish URLs are unavailable — only source checks (Helmet and seo-routes).',
  )
}

function auditCardStatusLine(report: SeoAuditReportView, allRoutesPassed: boolean, t: TranslateFn): string | null {
  if (!allRoutesPassed || report.summary.totalPages === 0) {
    return auditModeBanner(resolveAuditMode(report), t)
  }
  const auditMode = resolveAuditMode(report)
  if (auditMode === 'published') {
    return t(
      'builder_seo_audit_status_all_passed_published',
      undefined,
      'HTML checks on your published site — all routes passed.',
    )
  }
  if (auditMode === 'preview') {
    return t(
      'builder_seo_audit_status_all_passed_preview',
      undefined,
      'HTML checks on preview — all routes passed. Publish to verify the live site.',
    )
  }
  return t(
    'builder_seo_audit_status_all_passed_source',
    undefined,
    'Source checks passed (Helmet and seo-routes). Publish to make your changes live.',
  )
}

function IssueTabIntro({ issueView, t }: { issueView: SeoAuditIssueCategory; t: TranslateFn }) {
  const copy =
    issueView === 'seo'
      ? t(
          'builder_seo_audit_tab_intro_seo',
          undefined,
          'SEO helps search engines find and rank your pages using titles, headings, metadata, and social previews.',
        )
      : t(
          'builder_seo_audit_tab_intro_aeo',
          undefined,
          'AEO helps AI and rich results understand your pages using structured JSON-LD, consistent URLs, and entity data.',
        )

  return (
    <div className={`flex items-start gap-1.5 px-3 py-2 text-xs leading-relaxed text-intents-ux-box-foregroundColor ${AUDIT_PURPLE_PANEL}`}>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-2 shrink-0 translate-y-[2px] text-intents-ux-box-foregroundColor"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      >
        <circle cx="8" cy="8" r="6.25" />
        <path d="M8 7v4" strokeLinecap="round" />
        <circle cx="8" cy="5.25" r="0.75" fill="currentColor" stroke="none" />
      </svg>
      <p className="m-0">{copy}</p>
    </div>
  )
}

function RouteIssueCategoryList({
  issues,
  listKey,
  t,
}: {
  issues: SeoAuditIssueView[]
  listKey: string
  t: TranslateFn
}) {
  if (issues.length === 0) {
    return null
  }

  return (
    <ul className="m-0 list-none space-y-3 pl-0 text-sm text-foreground">
      {issues.map(issue => {
        const why = whyForSeoAuditIssue(issue.code, t)
        return (
          <li key={`${listKey}-${issue.code}`}>
            <p className="m-0 font-medium">{issue.label}</p>
            {why ? <p className="m-0 mt-0.5 text-xs leading-snug text-muted-foreground">{why}</p> : null}
          </li>
        )
      })}
    </ul>
  )
}

function formatSchemaTypeList(types: string[] | undefined, t: TranslateFn): string {
  if (!types?.length) {
    return t('builder_seo_audit_schema_none', undefined, 'None')
  }
  return types.join(', ')
}

function SchemaGuidanceSummary({
  presentTypes,
  recommendedTypes,
  recommendedFields,
  showTopBorder,
  t,
}: {
  presentTypes?: string[]
  recommendedTypes?: string[]
  recommendedFields?: string[]
  showTopBorder: boolean
  t: TranslateFn
}) {
  if (!recommendedTypes?.length && !recommendedFields?.length) {
    return null
  }

  return (
    <div
      className={`mt-2 text-xs ${showTopBorder ? 'border-t border-border pt-2' : ''}`}
    >
      <p className="m-0 mb-1.5 font-medium text-foreground">
        {t('builder_seo_audit_schema_status_heading', undefined, 'JSON-LD status on this page')}
      </p>
      <dl className="m-0 space-y-1">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
          <dt className="text-muted-foreground">
            {t('builder_seo_audit_schema_present', undefined, 'Present')}
          </dt>
          <dd className="m-0 font-mono text-foreground">{formatSchemaTypeList(presentTypes, t)}</dd>
          {recommendedTypes?.length ? (
            <>
              <dt className="text-muted-foreground">
                {t('builder_seo_audit_schema_recommended_types', undefined, 'Recommended types')}
              </dt>
              <dd className="m-0 font-mono text-foreground">{recommendedTypes.join(', ')}</dd>
            </>
          ) : null}
          {recommendedFields?.length ? (
            <>
              <dt className="text-muted-foreground">
                {t('builder_seo_audit_schema_recommended_fields', undefined, 'Recommended fields')}
              </dt>
              <dd className="m-0 font-mono text-foreground">{recommendedFields.join(', ')}</dd>
            </>
          ) : null}
        </div>
      </dl>
    </div>
  )
}

function ModalRouteAccordionItem({
  row,
  issueView,
  expanded,
  onToggle,
  t,
  schemaAeoByRoute,
  schemaTypesByRoute,
}: {
  row: RouteRow
  issueView: SeoAuditIssueCategory
  expanded: boolean
  onToggle: () => void
  t: TranslateFn
  schemaAeoByRoute?: Record<string, { types: string[]; fields: string[] }>
  schemaTypesByRoute?: Record<string, string[]>
}) {
  const activeCount = issueView === 'seo' ? row.seoIssueCount : row.aeoIssueCount
  const routeGuidance = schemaAeoByRoute?.[row.path]
  const presentTypes = schemaTypesByRoute?.[row.path]
  const issues = getRouteIssuesForView(row, issueView)
  const routeId = `seo-audit-route-${row.path.replace(/\//g, '_') || 'home'}`

  return (
    <section
      id={routeId}
      className="scroll-mt-2 rounded-md border border-intents-ux-box-borderColor bg-background"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${routeId}-panel`}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <AccordionChevron expanded={expanded} />
          <ModalRouteLabel path={row.path} t={t} />
        </span>
        <IssueCountBadge count={activeCount} t={t} />
      </button>

      {expanded ? (
        <div id={`${routeId}-panel`} className="border-t border-border px-3 py-2.5">
          {issues.length > 0 ? (
            <div className="space-y-3">
              {row.entries.map(entry => {
                const entryIssues = issuesForCategory(entry.issues, issueView)
                if (entryIssues.length === 0) {
                  return null
                }

                return (
                  <div key={`${row.path}-${entry.layer}`}>
                    {entry.layer === 'source' ? (
                      <p className="m-0 mb-1 text-xs font-medium text-muted-foreground">
                        {layerLabel(entry.layer, t)}
                      </p>
                    ) : null}
                    <RouteIssueCategoryList
                      issues={entryIssues}
                      listKey={`${row.path}-${entry.layer}-${issueView}`}
                      t={t}
                    />
                  </div>
                )
              })}
              {issues.length > 0 &&
              row.entries.every(entry => issuesForCategory(entry.issues, issueView).length === 0) ? (
                <RouteIssueCategoryList issues={issues} listKey={`${row.path}-${issueView}-merged`} t={t} />
              ) : null}
            </div>
          ) : issueView === 'aeo' && routeGuidance ? null : (
            <p className="m-0 text-sm text-muted-foreground">
              {issueView === 'seo'
                ? t('builder_seo_audit_empty_seo', undefined, 'No SEO issues found on checked routes.')
                : t('builder_seo_audit_empty_aeo', undefined, 'No AEO issues found on checked routes.')}
            </p>
          )}

          {issueView === 'aeo' && routeGuidance ? (
            <SchemaGuidanceSummary
              presentTypes={presentTypes}
              recommendedTypes={routeGuidance.types}
              recommendedFields={routeGuidance.fields}
              showTopBorder={issues.length > 0}
              t={t}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function ModalRouteAccordionList({
  rows,
  issueView,
  t,
  schemaAeoByRoute,
  schemaTypesByRoute,
}: {
  rows: RouteRow[]
  issueView: SeoAuditIssueCategory
  t: TranslateFn
  schemaAeoByRoute?: Record<string, { types: string[]; fields: string[] }>
  schemaTypesByRoute?: Record<string, string[]>
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setExpandedPaths(new Set())
  }, [issueView, rows])

  function togglePath(path: string) {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map(row => (
        <ModalRouteAccordionItem
          key={row.path}
          row={row}
          issueView={issueView}
          expanded={expandedPaths.has(row.path)}
          onToggle={() => togglePath(row.path)}
          t={t}
          schemaAeoByRoute={schemaAeoByRoute}
          schemaTypesByRoute={schemaTypesByRoute}
        />
      ))}
    </div>
  )
}

type SeoAuditDetailsModalProps = {
  isOpen: boolean
  onClose: () => void
  rows: RouteRow[]
  auditMode: SeoAuditMode
  htmlBaseUrl?: string | null
  schemaAeoByRoute?: Record<string, { types: string[]; fields: string[] }>
  schemaTypesByRoute?: Record<string, string[]>
  t: TranslateFn
}

function SeoAuditDetailsModal({
  isOpen,
  onClose,
  rows,
  auditMode,
  htmlBaseUrl,
  schemaAeoByRoute,
  schemaTypesByRoute,
  t,
}: SeoAuditDetailsModalProps) {
  const [issueView, setIssueView] = useState<SeoAuditIssueCategory>('seo')

  const seoRows = useMemo(() => rows.filter(row => row.seoIssueCount > 0), [rows])
  const aeoRows = useMemo(() => {
    if (schemaAeoByRoute) {
      return rows.filter(row => Boolean(schemaAeoByRoute[row.path]) || row.aeoIssueCount > 0)
    }
    return rows.filter(row => row.aeoIssueCount > 0)
  }, [rows, schemaAeoByRoute])

  function closeModal() {
    setIssueView('seo')
    onClose()
  }

  return (
    <ToolModal
      isOpen={isOpen}
      onClose={closeModal}
      title={t('builder_seo_aeo_audit_modal_title', undefined, 'SEO / AEO audit details')}
    >
      <div className="flex h-[70vh] max-h-[70vh] min-w-0 w-full flex-col gap-2 overflow-hidden pb-2">
        <div className="flex shrink-0 flex-col gap-2">
          <ButtonGroup
            value={issueView}
            onChange={value => setIssueView(value as SeoAuditIssueCategory)}
            className="w-fit self-center"
          >
            <ButtonGroup.Item
              value="seo"
              label={t('builder_seo_audit_tab_seo', undefined, 'SEO')}
              showLabelAlways
              className={ISSUE_VIEW_TOGGLE_INACTIVE}
            />
            <ButtonGroup.Item
              value="aeo"
              label={t('builder_seo_audit_tab_aeo', undefined, 'AEO')}
              showLabelAlways
              className={ISSUE_VIEW_TOGGLE_INACTIVE}
            />
          </ButtonGroup>

          <AuditSiteSourceBanner auditMode={auditMode} htmlBaseUrl={htmlBaseUrl} t={t} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-intents-ux-box-borderColor pt-2">
          <h3 className="mb-2 text-sm font-semibold m-0">
            {t('builder_seo_audit_modal_issues_heading', undefined, 'Issues by page')}
          </h3>
          <div className="grid min-w-0 grid-cols-1">
            <div
              className={`col-start-1 row-start-1 flex min-w-0 flex-col gap-2 ${issueView !== 'seo' ? 'invisible pointer-events-none' : ''}`}
              aria-hidden={issueView !== 'seo'}
            >
              <IssueTabIntro issueView="seo" t={t} />
              {seoRows.length === 0 ? (
                <div className="rounded-md border border-dashed border-intents-ux-box-borderColor px-4 py-6">
                  <p className="text-sm text-intents-ux-feedbackHighContrastPassive-feedbackColor m-0 text-center">
                    {t(
                      'builder_seo_audit_empty_seo',
                      undefined,
                      'No SEO issues found on checked routes.',
                    )}
                  </p>
                </div>
              ) : (
                <ModalRouteAccordionList rows={seoRows} issueView="seo" t={t} />
              )}
            </div>

            <div
              className={`col-start-1 row-start-1 flex min-w-0 flex-col gap-2 ${issueView !== 'aeo' ? 'invisible pointer-events-none' : ''}`}
              aria-hidden={issueView !== 'aeo'}
            >
              <IssueTabIntro issueView="aeo" t={t} />
              {aeoRows.length === 0 ? (
                <div className="rounded-md border border-dashed border-intents-ux-box-borderColor px-4 py-6">
                  <p className="text-sm text-intents-ux-feedbackHighContrastPassive-feedbackColor m-0 text-center">
                    {t(
                      'builder_seo_audit_empty_aeo',
                      undefined,
                      'No AEO issues found on checked routes.',
                    )}
                  </p>
                </div>
              ) : (
                <ModalRouteAccordionList
                  rows={aeoRows}
                  issueView="aeo"
                  t={t}
                  schemaAeoByRoute={schemaAeoByRoute}
                  schemaTypesByRoute={schemaTypesByRoute}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </ToolModal>
  )
}

export default function SeoAuditReportWidget({
  appId,
  report,
  offerFix = false,
  fixEnabled = true,
}: SeoAuditReportWidgetProps) {
  const t = useTranslations()
  const sendUserMessage = useSendUserMessage()
  const isStreaming = useIsActivelyStreaming()
  const isLoading = useIsLoading()
  const isProcessing = isStreaming || isLoading
  const canClickFix = offerFix && fixEnabled && !isProcessing && Boolean(sendUserMessage)
  const { summary, pages } = report
  const auditMode = resolveAuditMode(report)

  const [modalOpen, setModalOpen] = useState(false)

  const routeRows = useMemo(() => mergePagesByRoute(pages), [pages])
  const problemRows = useMemo(() => routeRows.filter(r => r.issueCount > 0), [routeRows])
  const allRoutesPassed = problemRows.length === 0 && summary.totalPages > 0
  const statusLine = auditCardStatusLine(report, allRoutesPassed, t)

  function handleFixClick() {
    if (!sendUserMessage || isProcessing) return
    const strategyNote = report.strategy?.analysisGuidance
      ? [`Strategy context from the report:\n${report.strategy.analysisGuidance}`]
      : []
    const schemaHints = report.schemaAeoByRoute
      ? Object.entries(report.schemaAeoByRoute)
          .map(
            ([path, guidance]) =>
              `${path}: types ${guidance.types.join(', ')}; fields ${guidance.fields.join(', ')}`,
          )
          .join('\n')
      : ''
    const schemaNote = schemaHints
      ? [
          `Recommended JSON-LD per route (from audit modal — not separate audit issues):\n${schemaHints}`,
          'If Present @types do not match the recommended types for a route, replace or add JSON-LD using a recommended @type (one per page is enough). Add recommended fields when you have accurate data — do not invent values.',
        ]
      : []
    const publishedBase = report.htmlBaseUrl ?? report.publishedBaseUrl ?? null
    const urlFixNote = publishedBase
      ? [
          `Published base URL for this audit: ${publishedBase}. Set canonical, og:url, and JSON-LD url per page with new URL(routePath, publishedBase).href — never example.com, acme.example, or other placeholder hosts.`,
        ]
      : [
          'Set canonical, og:url, and JSON-LD url from the published URL in App Status (new URL(routePath, publishedBase).href) — never example.com or placeholder hosts.',
        ]
    void sendUserMessage(
      t(
        'builder_seo_aeo_audit_fix_user_message',
        undefined,
        'Fix all SEO and AEO issues from the audit report.',
      ),
      {
        isActionRequest: true,
        customContext: {
          type: 'seo_audit_fix',
          data: {
            instructions: [
              'Fix every SEO and AEO issue listed in the audit report in the conversation above.',
              'Work through each route and issue from that report.',
              ...schemaNote,
              ...urlFixNote,
              ...strategyNote,
              'Do not call seoAnalysis or seo__audit again unless the user asks for a new audit.',
              auditMode === 'published'
                ? 'After code changes, remind the user to publish again to deploy fixes to the live site.'
                : 'After code changes, remind the user to publish so live HTML can be validated.',
            ],
          },
          persistence: 'ephemeral',
          source: 'seo-audit-report',
        },
      },
    )
  }

  return (
    <>
      <Box gap="md" className="rounded-lg border border-border bg-card p-3 my-2 shadow-sm flex flex-col">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <text.p className="font-semibold text-base m-0">
            {t('builder_seo_aeo_audit_report_title', undefined, 'SEO / AEO audit report')}
          </text.p>
          {(problemRows.length > 0 || Boolean(report.schemaAeoByRoute)) && (
            <Button
              design="secondary"
              size="small"
              onClick={() => setModalOpen(true)}
              text={t('builder_seo_audit_view_all', undefined, 'View details')}
            />
          )}
        </div>

        {statusLine ? <p className="text-sm text-muted-foreground m-0 leading-snug">{statusLine}</p> : null}

        {problemRows.length > 0 ? (
          <div className="rounded-md border border-border overflow-hidden">
            <div
              className={`${ISSUE_TABLE_COLUMNS} px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border`}
            >
              <span>{t('builder_seo_audit_col_route', undefined, 'Route')}</span>
              <span className="text-right">{t('builder_seo_audit_col_seo', undefined, 'SEO')}</span>
              <span className="text-right">{t('builder_seo_audit_col_aeo', undefined, 'AEO')}</span>
            </div>
            <ul className="m-0 p-0 list-none max-h-48 overflow-y-auto divide-y divide-border">
              {problemRows.map(row => (
                <li key={row.path} className={`${ISSUE_TABLE_COLUMNS} px-3 py-2.5 text-sm bg-background`}>
                  <span className="font-mono font-medium text-foreground truncate min-w-0">
                    {formatRoute(row.path)}
                  </span>
                  <span className="text-xs text-foreground text-right leading-tight">
                    {formatIssueCount(row.seoIssueCount, t)}
                  </span>
                  <span className="text-xs text-foreground text-right leading-tight">
                    {formatIssueCount(row.aeoIssueCount, t)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {offerFix && problemRows.length > 0 && (
          <Button
            design="primary"
            size="small"
            disabled={!canClickFix}
            onClick={handleFixClick}
            data-app-id={appId}
            text={t('builder_seo_audit_fix_button', undefined, 'Fix SEO & AEO issues')}
          />
        )}

        <p className="text-xs text-muted-foreground m-0 leading-snug">
          {t(
            'builder_seo_audit_recheck_hint',
            undefined,
            'Run this check again after you add pages, publish changes, or update your business info.',
          )}
        </p>
      </Box>

      <SeoAuditDetailsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        rows={routeRows}
        auditMode={auditMode}
        htmlBaseUrl={report.htmlBaseUrl ?? report.publishedBaseUrl}
        schemaAeoByRoute={report.schemaAeoByRoute}
        schemaTypesByRoute={report.schemaTypesByRoute}
        t={t}
      />
    </>
  )
}
