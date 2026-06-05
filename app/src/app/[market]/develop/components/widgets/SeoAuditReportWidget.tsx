'use client'

import { useMemo, useState } from 'react'
import Box from '@ux/box'
import Button from '@ux/button'
import text from '@ux/text'

import { useSendUserMessage } from '@/app/[market]/develop/components/chat/ChatContext'
import ToolModal from '@/app/[market]/develop/components/tool-renderers/ToolModal'
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
  entries: SeoPageAuditView[]
}

type TranslateFn = ReturnType<typeof useTranslations>

function formatRoute(path: string): string {
  return path === '/' ? '/' : path
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
      return {
        path,
        issueCount: issues.length,
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

function layerLabel(layer: SeoPageAuditView['layer'], t: TranslateFn): string {
  if (layer === 'published') {
    return t('builder_seo_audit_layer_published', undefined, 'Published site')
  }
  if (layer === 'preview') return t('builder_seo_audit_layer_preview', undefined, 'Preview')
  return t('builder_seo_audit_layer_source', undefined, 'Source code')
}

function StrategyLabeledLine({
  label,
  value,
  compact,
}: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <p className={`text-muted-foreground m-0 ${compact ? 'mt-1 line-clamp-2' : 'mt-2'}`}>
      <span className="font-medium text-foreground">{label}: </span>
      {value}
    </p>
  )
}

function StrategyContextBrief({
  strategy,
  compact,
  t,
}: {
  strategy: SeoStrategyView
  compact?: boolean
  t: TranslateFn
}) {
  const { businessInfo } = strategy
  const keywords = strategy.targetKeywords ?? []
  const keywordsText =
    compact && keywords.length > 8
      ? `${keywords.slice(0, 8).join(', ')} ${t('builder_seo_audit_strategy_keywords_overflow', { count: keywords.length - 8 }, '(+{count} more)')}`
      : keywords.join(', ')

  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      <p className={`font-medium text-foreground m-0 ${compact ? 'text-xs' : 'text-sm'}`}>
        {businessInfo.name}
      </p>
      {businessInfo.type ? (
        <StrategyLabeledLine
          label={t('builder_seo_audit_strategy_business_type', undefined, 'Business type')}
          value={businessInfo.type}
          compact={compact}
        />
      ) : null}
      {businessInfo.targetAudience ? (
        <StrategyLabeledLine
          label={t('builder_seo_audit_strategy_target_audience', undefined, 'Target audience')}
          value={businessInfo.targetAudience}
          compact={compact}
        />
      ) : null}
      {businessInfo.location ? (
        <StrategyLabeledLine
          label={t('builder_seo_audit_strategy_location', undefined, 'Location')}
          value={businessInfo.location}
          compact={compact}
        />
      ) : null}
      {keywords.length > 0 ? (
        <StrategyLabeledLine
          label={t('builder_seo_audit_strategy_keywords', undefined, 'Keywords')}
          value={keywordsText}
          compact={compact}
        />
      ) : null}
    </div>
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
    'Source checks passed (Helmet and seo-routes). Publish for live HTML validation.',
  )
}

type SeoAuditDetailsModalProps = {
  isOpen: boolean
  onClose: () => void
  rows: RouteRow[]
  auditMode: SeoAuditMode
  strategy?: SeoStrategyView
  t: TranslateFn
}

function SeoAuditDetailsModal({ isOpen, onClose, rows, auditMode, strategy, t }: SeoAuditDetailsModalProps) {
  const displayRows = rows.filter(r => r.issueCount > 0)
  const modeHint = auditModeBanner(auditMode, t)

  return (
    <ToolModal isOpen={isOpen} onClose={onClose} title={t('builder_seo_audit_modal_title', undefined, 'SEO audit details')}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            {strategy ? (
              <section className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <h3 className="text-xs font-semibold text-muted-foreground m-0 mb-2 uppercase tracking-wide">
                  {t('builder_seo_audit_strategy_heading', undefined, 'Strategy')}
                </h3>
                <StrategyContextBrief strategy={strategy} compact t={t} />
              </section>
            ) : null}

            {displayRows.length > 0 ? (
              <div className="flex flex-col gap-2">
                {modeHint ? (
                  <p className="text-xs text-muted-foreground m-0">{modeHint}</p>
                ) : null}
                <h3 className="text-sm font-semibold m-0">{t('builder_seo_audit_modal_issues_heading', undefined, 'Issues by page')}</h3>
              </div>
            ) : modeHint ? (
              <p className="text-xs text-muted-foreground m-0">{modeHint}</p>
            ) : null}
            {displayRows.length === 0 ? (
              <p className="text-sm text-muted-foreground m-0">
                {strategy
                  ? t(
                      'builder_seo_audit_modal_no_technical_issues',
                      undefined,
                      'No technical issues found on checked routes.',
                    )
                  : t('builder_seo_audit_modal_empty', undefined, 'No pages to show.')}
              </p>
            ) : (
              displayRows.map(row => (
                <section
                  key={row.path}
                  id={`seo-audit-route-${row.path.replace(/\//g, '_') || 'home'}`}
                  className="scroll-mt-2"
                >
                  <div className="flex items-baseline justify-between gap-2 border-b border-border pb-1 mb-2">
                    <h3 className="text-sm font-semibold m-0 font-mono">{formatRoute(row.path)}</h3>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {row.issueCount === 0
                        ? t('builder_seo_audit_modal_passed', undefined, 'Passed')
                        : t('builder_seo_audit_modal_issue_count', { count: row.issueCount }, '{count} issue(s)')}
                    </span>
                  </div>

                  {row.issueCount === 0 ? (
                    <p className="text-xs text-muted-foreground m-0">{t('builder_seo_audit_modal_no_issues', undefined, 'No issues found for this route.')}</p>
                  ) : (
                    <div className="space-y-3">
                      {row.entries.map(entry => (
                        <div key={`${row.path}-${entry.layer}`}>
                          <p className="text-xs font-medium text-muted-foreground m-0 mb-1">
                            {layerLabel(entry.layer, t)}
                            {entry.url ? (
                              <span className="font-normal block truncate text-[11px] mt-0.5">{entry.url}</span>
                            ) : null}
                          </p>
                          <ul className="m-0 pl-4 list-disc space-y-1 text-sm text-foreground">
                            {entry.issues.map(issue => (
                              <li key={`${entry.layer}-${issue.code}`}>{issue.label}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))
            )}
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
    void sendUserMessage(
      t('builder_seo_audit_fix_user_message', undefined, 'Fix the SEO issues from the audit report.'),
      {
        isActionRequest: true,
        customContext: {
          type: 'seo_audit_fix',
          data: {
            instructions: [
              'Fix every issue listed in the SEO audit report in the conversation above.',
              'Work through each route and issue from that report.',
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
          <text.p className="font-semibold text-base m-0">{t('builder_seo_audit_title', undefined, 'SEO audit report')}</text.p>
          {(problemRows.length > 0 || report.strategy) && (
            <Button
              design="secondary"
              size="small"
              onClick={() => setModalOpen(true)}
              text={t('builder_seo_audit_view_all', undefined, 'View details')}
            />
          )}
        </div>

        {statusLine ? <p className="text-sm text-muted-foreground m-0 leading-snug">{statusLine}</p> : null}

        {report.strategy ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground m-0 mb-1">
              {t('builder_seo_audit_strategy_heading', undefined, 'Strategy')}
            </p>
            <StrategyContextBrief strategy={report.strategy} compact t={t} />
          </div>
        ) : null}

        {problemRows.length > 0 ? (
          <div className="rounded-md border border-border overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-b border-border">
              <span>{t('builder_seo_audit_col_route', undefined, 'Route')}</span>
              <span className="text-right">{t('builder_seo_audit_col_issues', undefined, 'Issues')}</span>
            </div>
            <ul className="m-0 p-0 list-none max-h-48 overflow-y-auto divide-y divide-border">
              {problemRows.map(row => (
                <li
                  key={row.path}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2.5 items-center text-sm bg-background"
                >
                  <span className="font-mono font-medium text-foreground truncate min-w-0">
                    {formatRoute(row.path)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{row.issueCount}</span>
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
            text={t('builder_seo_audit_fix_button', undefined, 'Fix SEO issues')}
          />
        )}
      </Box>

      <SeoAuditDetailsModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        rows={routeRows}
        auditMode={auditMode}
        strategy={report.strategy}
        t={t}
      />
    </>
  )
}
