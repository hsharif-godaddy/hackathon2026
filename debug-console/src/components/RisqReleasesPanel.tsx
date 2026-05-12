'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import polish from '@/components/risq-polish.module.css';

import type { ParsedPr, ParsedRelease, ParsedReleaseLine } from '@/lib/releases-github';

export type RisqReleasesPayload = ParsedRelease & { past_releases: ParsedRelease[] };

function stripPast(r: RisqReleasesPayload): ParsedRelease {
  return {
    tag: r.tag,
    published_at: r.published_at,
    age: r.age,
    author: r.author,
    html_url: r.html_url,
    diff_url: r.diff_url,
    prs: r.prs,
    slack_url: r.slack_url,
    test: r.test,
    prod: r.prod,
  };
}

function sidebarList(data: RisqReleasesPayload): ParsedRelease[] {
  if (data.past_releases.length > 0) return data.past_releases;
  return [stripPast(data)];
}

function formatSidebarDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatHeaderDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

type MainTab = 'what' | 'pipeline';

const linkStyle: CSSProperties = {
  color: '#2563eb',
  fontWeight: 600,
  fontSize: '0.8rem',
  textDecoration: 'none',
};

const SRE_DASHBOARD_URL = 'http://sre-airo-release-dashboard.int.gdcorp.tools/';

function PrRow({ pr }: { pr: ParsedPr }) {
  const handle = pr.author.startsWith('@') ? pr.author : `@${pr.author}`;
  const profileUrl = `https://github.com/${pr.author.replace(/^@/, '')}`;
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '1rem',
        padding: '0.62rem 0',
        borderBottom: '1px solid #eef0f3',
        fontSize: '0.84rem',
        color: '#374151',
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        # PR #{pr.number}: {pr.title}
      </span>
      <a href={profileUrl} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, flexShrink: 0, whiteSpace: 'nowrap' }}>
        {handle}
      </a>
    </div>
  );
}

function PipelineRow({ row }: { row: ParsedReleaseLine }) {
  return (
    <div
      style={{
        padding: '0.55rem 0',
        borderBottom: '1px solid #eef0f3',
        fontSize: '0.84rem',
        color: '#374151',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '0.35rem 0.75rem',
      }}
    >
      <span style={{ flexShrink: 0 }}>{row.icon ? `${row.icon} ` : ''}</span>
      <span style={{ flex: '1 1 200px', minWidth: 0 }}>{row.label}</span>
      {row.url ? (
        <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontSize: '0.78rem' }}>
          View run ↗
        </a>
      ) : null}
    </div>
  );
}

export interface RisqReleasesPanelProps {
  release: RisqReleasesPayload;
}

export default function RisqReleasesPanel({ release }: RisqReleasesPanelProps) {
  const items = sidebarList(release);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [mainTab, setMainTab] = useState<MainTab>('what');

  useEffect(
    function syncSelectionOnDataChange() {
      setSelectedIdx(0);
    },
    [release],
  );

  const selected = items[selectedIdx] ?? items[0];
  if (!selected) return null;

  const whatMeta = [
    formatSidebarDate(selected.published_at),
    selected.author ? `@${selected.author.replace(/^@/, '')}` : '',
    selected.age,
  ]
    .filter(Boolean)
    .join(' · ');

  const pipelineMeta = [
    formatHeaderDateTime(selected.published_at),
    selected.author ? `@${selected.author.replace(/^@/, '')}` : '',
    selected.age,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={polish.releasesRoot}
      style={{
        backgroundColor: '#ffffff',
        borderRadius: 12,
        border: '1px solid #e8e9f0',
        boxShadow: '0 4px 22px rgba(15,23,42,0.07)',
        overflow: 'hidden',
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ padding: '0.65rem 1.1rem 0' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: '0.75rem',
            marginBottom: '0.45rem',
          }}
        >
          <div
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: '#9ca3af',
            }}
          >
            RELEASES
          </div>
          <a
            href={SRE_DASHBOARD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={polish.sreDashLink}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.4rem 0.75rem',
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '0.72rem',
              fontWeight: 700,
              border: '1px solid #bfdbfe',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden style={{ fontSize: '0.78rem', lineHeight: 1 }}>
              ↗
            </span>
            SRE Dashboard
          </a>
        </div>
        <div style={{ display: 'flex', gap: '1.35rem', borderBottom: '1px solid #e5e7eb' }}>
          <button
            type="button"
            className={`${polish.releasesMainTab}${mainTab !== 'what' ? ` ${polish.releasesMainTabInactive}` : ''}`}
            onClick={function selectWhat() {
              setMainTab('what');
            }}
            style={{
              padding: '0.45rem 0',
              marginBottom: -1,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '0.84rem',
              fontWeight: 600,
              color: mainTab === 'what' ? '#2563eb' : '#6b7280',
              borderBottom: mainTab === 'what' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            What Changed
          </button>
          <button
            type="button"
            className={`${polish.releasesMainTab}${mainTab !== 'pipeline' ? ` ${polish.releasesMainTabInactive}` : ''}`}
            onClick={function selectPipeline() {
              setMainTab('pipeline');
            }}
            style={{
              padding: '0.45rem 0',
              marginBottom: -1,
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: '0.84rem',
              fontWeight: 600,
              color: mainTab === 'pipeline' ? '#2563eb' : '#6b7280',
              borderBottom: mainTab === 'pipeline' ? '2px solid #2563eb' : '2px solid transparent',
            }}
          >
            Deployment Pipeline
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', minHeight: 280, alignItems: 'stretch' }}>
        <aside
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
          }}
        >
          {items.map(function sidebarItem(rel, idx) {
            const isSel = idx === selectedIdx;
            return (
              <button
                key={`${rel.tag}-${idx}`}
                type="button"
                className={polish.releasesSidebarBtn}
                onClick={function selectRelease() {
                  setSelectedIdx(idx);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.65rem 0.85rem',
                  border: 'none',
                  borderLeft: isSel ? '3px solid #2563eb' : '3px solid transparent',
                  backgroundColor: isSel ? '#ffffff' : 'transparent',
                  cursor: 'pointer',
                  display: 'block',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.82rem', color: isSel ? '#1d4ed8' : '#111827' }}>{rel.tag}</div>
                <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: '0.15rem' }}>{formatSidebarDate(rel.published_at)}</div>
              </button>
            );
          })}
        </aside>

        <main style={{ flex: 1, minWidth: 0, backgroundColor: '#ffffff', padding: '1.15rem 1.4rem 1.45rem' }}>
          {mainTab === 'what' ? (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  marginBottom: '0.35rem',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#111827' }}>{selected.tag}</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{whatMeta}</span>
                  {selected.html_url ? (
                    <a href={selected.html_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      GitHub ↗
                    </a>
                  ) : null}
                  {selected.diff_url ? (
                    <a href={selected.diff_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      Compare ↗
                    </a>
                  ) : null}
                </div>
              </div>
              <div style={{ marginTop: '0.75rem' }}>
                {selected.prs.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '0.84rem', color: '#9ca3af' }}>No pull requests parsed for this release.</p>
                ) : (
                  selected.prs.map(function mapPr(pr) {
                    return <PrRow key={pr.number} pr={pr} />;
                  })
                )}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#111827' }}>{selected.tag}</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{pipelineMeta}</span>
                  {selected.html_url ? (
                    <a href={selected.html_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      GitHub ↗
                    </a>
                  ) : null}
                  {selected.slack_url ? (
                    <a href={selected.slack_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      Slack thread ↗
                    </a>
                  ) : null}
                  {selected.diff_url ? (
                    <a href={selected.diff_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      Compare ↗
                    </a>
                  ) : null}
                </div>
              </div>

              {selected.test.length > 0 ? (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      color: '#6b7280',
                      marginBottom: '0.35rem',
                    }}
                  >
                    TEST
                  </div>
                  {selected.test.map(function mapTest(row, i) {
                    return <PipelineRow key={`test-${i}`} row={row} />;
                  })}
                </div>
              ) : null}

              {selected.prod.length > 0 ? (
                <div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      color: '#6b7280',
                      marginBottom: '0.35rem',
                    }}
                  >
                    PROD
                  </div>
                  <ul style={{ margin: 0, padding: '0 0 0 1.1rem', listStyleType: 'circle', color: '#374151' }}>
                    {selected.prod.map(function mapProd(row, i) {
                      return (
                        <li key={`prod-${i}`} style={{ marginBottom: '0.45rem', fontSize: '0.84rem', paddingLeft: '0.15rem' }}>
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noopener noreferrer" style={{ color: '#374151', textDecoration: 'none' }}>
                              {row.label}
                            </a>
                          ) : (
                            row.label
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {selected.test.length === 0 && selected.prod.length === 0 ? (
                <p style={{ margin: 0, fontSize: '0.84rem', color: '#9ca3af' }}>No deployment pipeline details in this release body.</p>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
