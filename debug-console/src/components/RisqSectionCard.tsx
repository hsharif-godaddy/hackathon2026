'use client';

import type { CSSProperties, ReactNode } from 'react';

import polish from '@/components/risq-polish.module.css';

export type RisqSectionCardVariant = 'default' | 'compact';

export function risqPillToggleStyle(active: boolean): CSSProperties {
  return {
    padding: '0.38rem 0.9rem',
    fontSize: '0.78rem',
    fontWeight: 600,
    borderRadius: 999,
    border: active ? '1px solid #2563eb' : '1px solid #e5e7eb',
    background: active ? '#2563eb' : '#ffffff',
    color: active ? '#ffffff' : '#64748b',
    cursor: 'pointer',
    boxShadow: active ? '0 2px 10px rgba(37, 99, 235, 0.25)' : '0 1px 4px rgba(15, 23, 42, 0.04)',
    transition: 'background 0.18s ease, color 0.18s ease, border-color 0.18s ease, box-shadow 0.2s ease, transform 0.18s ease',
  };
}

export const risqSectionSurface: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  borderRadius: 14,
  border: '1px solid #e4eaf4',
  boxShadow: '0 4px 28px rgba(59, 130, 246, 0.06), 0 0 0 1px rgba(255, 255, 255, 0.8)',
  overflow: 'hidden',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export const risqSectionSurfaceCompact: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  borderRadius: 12,
  border: '1px solid #e4eaf4',
  boxShadow: '0 2px 16px rgba(59, 130, 246, 0.05)',
  overflow: 'hidden',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
};

export const risqSectionInnerWell: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
  borderRadius: 12,
  border: '1px solid #e4eaf4',
  padding: '1.2rem 1.3rem',
  boxShadow: '0 2px 10px rgba(59, 130, 246, 0.04)',
};

export const risqSectionDataPanel: CSSProperties = {
  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
  borderRadius: 12,
  border: '1px solid #e4eaf4',
  padding: '1.45rem 1.55rem',
  boxShadow: '0 2px 12px rgba(59, 130, 246, 0.045)',
};

function headerStyle(variant: RisqSectionCardVariant): CSSProperties {
  if (variant === 'compact') {
    return {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '0.75rem',
      padding: '1.05rem 1.28rem',
      borderBottom: '1px solid #edf2fa',
      backgroundColor: '#ffffff',
    };
  }
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.85rem',
    padding: '1.28rem 1.55rem',
    borderBottom: '1px solid #edf2fa',
    backgroundColor: '#ffffff',
  };
}

const titleRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  minWidth: 0,
};

function titleTextStyle(variant: RisqSectionCardVariant): CSSProperties {
  if (variant === 'compact') {
    return {
      fontSize: '0.78rem',
      fontWeight: 600,
      color: '#334155',
      letterSpacing: '-0.01em',
    };
  }
  return {
    fontSize: '0.84rem',
    fontWeight: 600,
    color: '#0f172a',
    letterSpacing: '-0.015em',
  };
}

function bodyStyle(variant: RisqSectionCardVariant, bodyBackground?: string): CSSProperties {
  if (variant === 'compact') {
    return {
      padding: '1.35rem 1.4rem 1.5rem',
      backgroundColor: bodyBackground ?? '#f7faff',
    };
  }
  return {
    padding: '1.55rem 1.65rem 1.7rem',
    backgroundColor: bodyBackground ?? '#ffffff',
  };
}

export interface RisqSectionCardProps {
  title: string;
  icon?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  marginBottom?: string;
  variant?: RisqSectionCardVariant;
  bodyBackground?: string;
}

export default function RisqSectionCard({
  title,
  icon,
  subtitle,
  actions,
  children,
  marginBottom = '1rem',
  variant = 'default',
  bodyBackground,
}: RisqSectionCardProps) {
  const surface = variant === 'compact' ? risqSectionSurfaceCompact : risqSectionSurface;
  const hoverClass =
    variant === 'compact' ? `${polish.sectionCard} ${polish.sectionCardCompact}` : polish.sectionCard;
  return (
    <section className={hoverClass} style={{ ...surface, marginBottom }}>
      <div style={headerStyle(variant)}>
        <div style={{ minWidth: 0, flex: '1 1 160px' }}>
          <div style={titleRow}>
            {icon ? (
              <span style={{ fontSize: '1rem', lineHeight: 1, flexShrink: 0 }} aria-hidden>
                {icon}
              </span>
            ) : null}
            <span style={titleTextStyle(variant)}>{title}</span>
          </div>
          {subtitle ? (
            <div
              style={{
                margin: '0.45rem 0 0 0',
                fontSize: variant === 'compact' ? '0.72rem' : '0.75rem',
                color: '#64748b',
                lineHeight: 1.5,
                maxWidth: '52rem',
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>{actions}</div>
        ) : null}
      </div>
      <div style={bodyStyle(variant, bodyBackground)}>{children}</div>
    </section>
  );
}
