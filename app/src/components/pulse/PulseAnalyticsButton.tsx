'use client'

import { useState } from 'react'

import { useAppIdFromParams } from '@/app/[market]/develop/components/utils'
import { cn } from '@/lib/utils'
import { useSiteStore } from '@/stores/useSiteStore'

interface Metric {
  name: string
  before: string
  after: string
  bp: number
  ap: number
  lift: string
}

interface AnalyticsData {
  fix: string
  fixDesc: string
  metrics: Metric[]
}

const ANALYTICS: Record<string, AnalyticsData> = {
  candle: {
    fix: 'Testimonials section',
    fixDesc: 'Adding social proof below your hero is converting first-time visitors. 14 days of A/B data shows the variant winning.',
    metrics: [
      { name: 'Checkout Completions', before: '1.3%', after: '2.4%', bp: 26, ap: 48, lift: '+84%' },
      { name: 'Email Sign-ups',       before: '4.2%', after: '7.8%', bp: 21, ap: 39, lift: '+86%' },
      { name: 'Avg Session Time',     before: '1:24', after: '2:51', bp: 28, ap: 57, lift: '+104%' },
      { name: 'Bounce Rate',          before: '54%',  after: '37%',  bp: 81, ap: 55, lift: '−31%' },
    ],
  },
  pizza: {
    fix: 'Move contact form higher',
    fixDesc: 'Putting the contact CTA above the fold means visitors reach you before scrolling away.',
    metrics: [
      { name: 'Reservation Requests', before: '4/day',  after: '6.7/day', bp: 40, ap: 67, lift: '+67%' },
      { name: 'Form Submissions',     before: '2.8%',   after: '3.9%',    bp: 28, ap: 39, lift: '+41%' },
      { name: 'Phone Call Clicks',    before: '1.8%',   after: '2.3%',    bp: 36, ap: 46, lift: '+28%' },
      { name: 'Bounce Rate',          before: '52%',    after: '39%',     bp: 78, ap: 59, lift: '−25%' },
    ],
  },
  bakery: {
    fix: 'CTA in hero',
    fixDesc: "Moving the order button into the hero means customers act the moment they land — no scrolling required.",
    metrics: [
      { name: 'Order Button Clicks',  before: '1.2%', after: '2.3%', bp: 24, ap: 46, lift: '+89%' },
      { name: 'Pre-order Rate',       before: '0.8%', after: '1.2%', bp: 16, ap: 24, lift: '+52%' },
      { name: 'Hero Click-Through',   before: '3.1%', after: '5.5%', bp: 31, ap: 55, lift: '+78%' },
      { name: 'Bounce Rate',          before: '44%',  after: '34%',  bp: 66, ap: 51, lift: '−22%' },
    ],
  },
}

const DATASET_KEYS: ReadonlyArray<string> = ['candle', 'pizza', 'bakery'] as const

function pickDataset(name: string | undefined, url: string | undefined, appId: string | null): AnalyticsData {
  const haystack = `${name ?? ''} ${url ?? ''} ${appId ?? ''}`.toLowerCase()
  if (haystack.includes('candle') || haystack.includes('sarah')) return ANALYTICS.candle
  if (haystack.includes('pizza') || haystack.includes('marco')) return ANALYTICS.pizza
  if (haystack.includes('baker') || haystack.includes('bread') || haystack.includes('ben')) return ANALYTICS.bakery
  return ANALYTICS.candle
}

export function PulseAnalyticsButton() {
  const [open, setOpen] = useState<boolean>(false)

  const appId: string | null = useAppIdFromParams()
  const site = useSiteStore((s) => (appId ? s.getSite(appId) : null))
  const data: AnalyticsData = pickDataset(site?.name, site?.published_url, appId)

  return (
    <>
      <button
        type="button"
        aria-label="Pulse Analytics"
        onClick={() => { setOpen(!open) }}
        className={cn(
          'relative flex items-center gap-1 px-1.5 py-1 rounded-xmd shrink-0 transition-colors duration-200 text-sm font-medium whitespace-nowrap cursor-pointer',
          open
            ? 'bg-[#7c3aed] text-white shadow-md'
            : 'bg-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]'
        )}
      >
        <span className={open ? 'text-white' : 'text-[#7c3aed]'}>Analytics</span>
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', top: '44px', right: 0, bottom: 0, width: '340px',
            background: '#fff', borderLeft: '1px solid #e5e7eb',
            boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', zIndex: 9999,
          }}
        >
          {/* Header */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📊 Pulse Analytics
            </div>
            <button type="button" onClick={() => { setOpen(false) }} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px', padding: '2px 6px', borderRadius: '4px' }}>✕</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '4px 10px', fontSize: '11px', color: '#15803d', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '16px' }}>
              🧪 A/B Test · Running 14 days · 94% confidence
            </div>

            <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>Key Metrics</div>

            {data.metrics.map((m: Metric) => (
              <div key={m.name} style={{ background: '#f9fafb', borderRadius: '8px', padding: '11px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '7px' }}>
                  <div style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>{m.name}</div>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a' }}>
                    {m.lift.startsWith('−') ? '↓' : '↑'} {m.lift}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {(['before', 'after'] as const).map((type: 'before' | 'after') => (
                    <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', color: '#6b7280' }}>
                      <div style={{ width: '38px', textAlign: 'right', flexShrink: 0 }}>{type === 'before' ? 'Before' : 'After'}</div>
                      <div style={{ flex: 1, height: '6px', background: '#e5e7eb', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: '3px', background: type === 'before' ? '#d1d5db' : '#22c55e', width: `${type === 'before' ? m.bp : m.ap}%` }} />
                      </div>
                      <div style={{ width: '40px', flexShrink: 0, fontWeight: 600, color: '#374151', fontSize: '11px' }}>{type === 'before' ? m.before : m.after}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div style={{ height: '1px', background: '#f3f4f6', margin: '14px 0' }} />

            <div style={{ background: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', border: '1px solid #ddd6fe', borderRadius: '10px', padding: '12px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>⚡ Suggested Fix</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e1b4b', marginBottom: '4px' }}>{data.fix}</div>
              <div style={{ fontSize: '11px', color: '#6b7280', lineHeight: 1.5 }}>{data.fixDesc}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
                <div style={{ fontSize: '11px', color: '#374151', fontWeight: 500 }}>94% statistical confidence · Variant B leading</div>
              </div>
            </div>
          </div>

          {/* Footer CTA */}
          <div style={{ padding: '14px 16px', borderTop: '1px solid #f3f4f6', flexShrink: 0 }}>
            <button
              type="button"
              style={{ width: '100%', background: '#7c3aed', border: 'none', color: '#fff', padding: '12px', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: 1.5, textAlign: 'center' }}
            >
              This is showing positive growth —<br />apply this change to your live site →
            </button>
            <div style={{ textAlign: 'center', fontSize: '10px', color: '#9ca3af', marginTop: '5px' }}>Changes go live after you publish</div>
          </div>
        </div>
      )}
    </>
  )
}
