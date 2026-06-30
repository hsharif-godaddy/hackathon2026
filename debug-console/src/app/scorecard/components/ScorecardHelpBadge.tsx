'use client';

import { useEffect, useRef, useState } from 'react';

export interface ScorecardHelpInfo {
  what: string;
  how: string;
  reading?: string;
}

export function ScorecardHelpBadge({ info, color = 'var(--sp-txm)' }: { info: ScorecardHelpInfo; color?: string }) {
  const [open, setOpen]     = useState(false);
  const [anchor, setAnchor] = useState<'left' | 'right'>('right');
  const btnRef              = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect: DOMRect = btnRef.current.getBoundingClientRect();
    const vw: number    = typeof window !== 'undefined' ? window.innerWidth : 1280;
    setAnchor(rect.left + rect.width / 2 < vw / 2 ? 'left' : 'right');
  }, [open]);

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-label="Chart details"
        style={{
          width: '16px', height: '16px', lineHeight: '14px',
          borderRadius: '50%',
          border: `1px solid ${color}`,
          backgroundColor: open ? color : 'transparent',
          color: open ? 'var(--sp-bg)' : color,
          cursor: 'pointer',
          fontSize: '0.65rem', fontWeight: 700,
          padding: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ?
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: '22px',
            ...(anchor === 'right' ? { right: 0 } : { left: 0 }),
            zIndex: 20,
            width: '280px',
            maxWidth: 'calc(100vw - 2rem)',
            backgroundColor: 'var(--sp-s2)',
            color: 'var(--sp-tx1)',
            border: '1px solid var(--sp-border)',
            borderRadius: '8px',
            padding: '0.75rem 0.9rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            fontSize: '0.7rem',
            lineHeight: 1.5,
            textAlign: 'left',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.4rem' }}>
            <strong style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)' }}>What</strong>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--sp-txm)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>×</button>
          </div>
          <div style={{ marginBottom: '0.5rem', color: 'var(--sp-tx2)' }}>{info.what}</div>
          <strong style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)' }}>How it&apos;s calculated</strong>
          <div style={{ marginTop: '0.25rem', marginBottom: info.reading ? '0.5rem' : 0, color: 'var(--sp-tx2)', fontFamily: 'ui-monospace, monospace', fontSize: '0.65rem' }}>{info.how}</div>
          {info.reading && (
            <>
              <strong style={{ fontSize: '0.72rem', color: 'var(--sp-tx1)' }}>How to read</strong>
              <div style={{ marginTop: '0.25rem', color: 'var(--sp-tx2)' }}>{info.reading}</div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
