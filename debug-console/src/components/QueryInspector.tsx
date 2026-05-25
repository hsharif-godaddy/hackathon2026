'use client';

import React, { useMemo, useState } from 'react';

import { isESSource, renderESQueryPreview } from '@/lib/es-query';
import { renderLogQLPreview } from '@/lib/logql-preview';

interface QueryInspectorProps {
  /** Currently selected source id from the panel header. */
  sourceId: string;
  /** App id from the global filter, or empty string. */
  appId: string;
  /**
   * Cluster resolution tri-state:
   *   - undefined → still loading; preview shows a placeholder
   *   - null → resolved with no cluster (e.g. PaaS app); preview omits it
   *   - string → resolved cluster id
   */
  cluster: string | null | undefined;
  levels: { error: boolean; warn: boolean };
  filterText: string;
}

const ENV_LABEL = process.env.NEXT_PUBLIC_ENVIRONMENT_NAME || 'dev';

interface RenderedQuery {
  /** Display label for the header chip. */
  flavor: 'LogQL' | 'Elasticsearch';
  /** The query body as text. */
  text: string;
}

/**
 * Read-only viewer for the query the Logs tab is about to send. Live-rendered
 * from the panel's filter state. Renders LogQL for Loki sources and the ES
 * request body (pretty-printed JSON) for Elasticsearch sources.
 */
export default function QueryInspector(props: QueryInspectorProps) {
  const [open, setOpen] = useState(false);

  const rendered = useMemo<RenderedQuery>(() => {
    if (isESSource(props.sourceId)) {
      const text = renderESQueryPreview({
        sourceId: props.sourceId,
        appId: props.appId,
        levels: props.levels,
        filterText: props.filterText,
      });
      return { flavor: 'Elasticsearch', text: text ?? '(unsupported source)' };
    }
    return {
      flavor: 'LogQL',
      text: renderLogQLPreview({
        sourceId: props.sourceId,
        env: ENV_LABEL,
        appId: props.appId,
        cluster: props.cluster,
        levels: props.levels,
        filterText: props.filterText,
      }),
    };
  }, [props.sourceId, props.appId, props.cluster, props.levels, props.filterText]);

  return (
    <div
      style={{
        marginTop: '0.75rem',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        backgroundColor: '#fafafa',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.5rem 0.875rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: '0.813rem',
          fontWeight: 600,
          color: '#374151',
        }}
      >
        <span>{open ? '▾' : '▸'} {rendered.flavor} query</span>
        <span style={{ fontWeight: 400, color: '#6b7280', fontSize: '0.75rem' }}>
          rendered from filters
        </span>
      </button>

      {open && (
        <div style={{ padding: '0.75rem 0.875rem 0.875rem', borderTop: '1px solid #e5e7eb' }}>
          <pre
            style={{
              margin: 0,
              padding: '0.5rem 0.625rem',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              color: '#1e293b',
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '6px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              maxHeight: '320px',
              overflow: 'auto',
            }}
          >
            {rendered.text}
          </pre>

          {rendered.flavor === 'LogQL' && props.appId && props.cluster === undefined && (
            <p
              style={{
                margin: '0.5rem 0 0',
                fontSize: '0.7rem',
                color: '#6b7280',
                fontStyle: 'italic',
              }}
            >
              Resolving cluster from app id…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
