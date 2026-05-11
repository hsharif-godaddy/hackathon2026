'use client';

import { useEffect, useRef, useState } from 'react';

// Info: what this chart / pill represents, how it's calculated, how to read it.
// Click the `?` badge to toggle an inline details popover.
export interface HelpInfo {
  what: string;       // One-line summary of the metric
  how: string;        // Calculation / formula / filter
  reading?: string;   // How to interpret the number (optional)
}

export function HelpBadge({ info, color = '#64748b' }: { info: HelpInfo; color?: string }) {
  const [open, setOpen] = useState(false);
  // Anchor flips between `left: 0` and `right: 0` depending on which side
  // of the viewport the badge sits on — otherwise the 280px popover
  // clips off-screen for badges in the leftmost / rightmost cards.
  const [anchor, setAnchor] = useState<'left' | 'right'>('right');
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    setAnchor(rect.left + rect.width / 2 < vw / 2 ? 'left' : 'right');
  }, [open]);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label="Chart details"
        style={{
          width: '16px', height: '16px', lineHeight: '14px',
          borderRadius: '50%',
          border: `1px solid ${color}`,
          backgroundColor: open ? color : 'transparent',
          color: open ? 'white' : color,
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
            backgroundColor: '#0f172a',
            color: '#e2e8f0',
            borderRadius: '8px',
            padding: '0.75rem 0.9rem',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            fontSize: '0.7rem',
            lineHeight: 1.5,
            textAlign: 'left',
            textTransform: 'none',
            letterSpacing: 'normal',
            fontWeight: 400,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '0.4rem' }}>
            <strong style={{ fontSize: '0.72rem' }}>What</strong>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}>×</button>
          </div>
          <div style={{ marginBottom: '0.5rem', color: '#cbd5e1' }}>{info.what}</div>
          <strong style={{ fontSize: '0.72rem' }}>How it&apos;s calculated</strong>
          <div style={{ marginTop: '0.25rem', marginBottom: info.reading ? '0.5rem' : 0, color: '#cbd5e1', fontFamily: 'ui-monospace, monospace', fontSize: '0.65rem' }}>{info.how}</div>
          {info.reading && (
            <>
              <strong style={{ fontSize: '0.72rem' }}>How to read</strong>
              <div style={{ marginTop: '0.25rem', color: '#cbd5e1' }}>{info.reading}</div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
