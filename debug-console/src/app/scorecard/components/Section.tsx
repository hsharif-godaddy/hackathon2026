'use client';

import React from 'react';

interface Props {
  title:    React.ReactNode;
  sub?:     string;
  right?:   React.ReactNode;
  children: React.ReactNode;
  style?:   React.CSSProperties;
}

export function Section({ title, sub, right, children, style }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', ...style }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--sp-tx2)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>{title}</h3>
          {sub && <p style={{ margin: '0.1rem 0 0', fontSize: '0.63rem', color: 'var(--sp-tx2)' }}>{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
