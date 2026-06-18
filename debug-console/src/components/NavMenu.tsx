'use client';

import { useEffect, useRef, useState } from 'react';

// Top-right hamburger menu collapsing the console's cross-page nav links into a
// single dropdown. Each item is a plain link; external links open in a new tab.
interface NavItem {
  label: string;
  href: string;
  /** Accent dot color, mirrors the old button colors. */
  color: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Analytics', href: '/analytics', color: '#3b82f6' },
  { label: 'RISQ', href: '/risq', color: '#7c3aed' },
  { label: 'Support Plane', href: '/supportplane', color: '#0891b2' },
  { label: 'E2E Runs', href: '/e2e-run-dashboard', color: '#6366f1' },
  { label: 'Images', href: '/image-search', color: '#6b7280' },
  {
    label: 'Logo Sessions',
    href: 'https://logo-agent.mvci.api.godaddy.com/admin/sessions',
    color: '#0ea5e9',
  },
];

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Navigation menu"
        aria-expanded={open}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          height: '40px',
          padding: '0 0.9375rem',
          backgroundColor: open ? '#0d9488' : '#14b8a6',
          color: 'white',
          border: '1px solid #0d9488',
          borderRadius: '5px',
          cursor: 'pointer',
          fontSize: '1.016rem',
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: '1.25rem' }}>☰</span>
        Menu
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '38px',
            right: 0,
            zIndex: 20,
            minWidth: '260px',
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            padding: '0.5rem',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.375rem',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 0.875rem',
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                backgroundColor: '#f9fafb',
                color: '#111827',
                textDecoration: 'none',
                fontSize: '0.938rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                transition: 'background-color 0.12s, border-color 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#eff6ff';
                e.currentTarget.style.borderColor = '#bfdbfe';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#f9fafb';
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: item.color,
                  flexShrink: 0,
                }}
              />
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
