'use client';

import type { JSX, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrandDataMoodImage } from '@airo/shared/brand-data';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme';
import { previewFontInIframe } from '@/app/[market]/develop/components/utils/previewFontInIframe';
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { designKitApi, type FontChoice } from './designKitApi';
import { FontPicker } from './FontPicker';
import type { BrandDataPalette } from './useBrandData';
import { useBrandData } from './useBrandData';

/**
 * Step-3 "Design your visuals" — the edit / refine workstation.
 *
 * A dense, three-column, tool-forward editor (the "Studio" direction): every
 * element is editable in place — Pantone-style colour chips with a pick/hex
 * popover, Figma-style font pickers with live specimens, a manifest-resolved
 * logo, a mood board, editable voice, kit-shaped element previews, and a
 * read-only Airo-authored brand summary. The chrome is Airo-branded
 * (`--color-ai`); the user's brand colours fill content.
 */

const AIRO = 'var(--color-ai)';

const PANEL =
  'flex flex-col rounded-xl border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-2 shadow-[0_1px_2px_rgba(24,24,30,0.04),0_8px_22px_-18px_rgba(24,24,30,0.16)]';

const COLOR_SLOTS: Array<{ key: keyof BrandDataPalette; label: string }> = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'muted', label: 'Muted' },
];

const LOGO_SLOT_NAMES = ['logo/primary', 'logo/horizontal', 'logo/vertical'] as const;

/* ------------------------------------------------------------------ utils */

/** Coerce any colour string to a `#rrggbb` value the native picker accepts. */
function normalizeHex(value?: string): string {
  if (!value) return '#888888';
  let v = value.trim();
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#888888';
}

/** Pick a readable foreground (white / near-black) for a given background hex. */
function readableOn(hex: string): string {
  const h = normalizeHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#1b1b20' : '#ffffff';
}

/**
 * Approximate the chosen kit's element "shape language" from its name.
 * The kit's real shape tokens (anchor.json) aren't surfaced to the frontend yet,
 * so this is a keyword heuristic over the kit name — persist anchor.json tokens
 * for exact shapes as a follow-up.
 */
function kitShape(name?: string): {
  radius: string; cardRadius: string; badgeRadius: string; shadow: string; transform: 'uppercase' | 'none'; tracking: string;
} {
  const s = (name ?? '').toLowerCase();
  if (/editorial|luxe|minimal|heritage|retro|refined|elegant|sophisticat|classic|timeless|serif|mono/.test(s)) {
    return { radius: '3px', cardRadius: '2px', badgeRadius: '2px', shadow: 'none', transform: 'uppercase', tracking: '0.1em' };
  }
  if (/playful|bold|vibrant|fun|pop|energ|youth|quirky|friendly|round|soft/.test(s)) {
    return { radius: '9999px', cardRadius: '18px', badgeRadius: '9999px', shadow: '0 8px 20px -10px rgba(0,0,0,0.25)', transform: 'none', tracking: '0' };
  }
  return { radius: '10px', cardRadius: '12px', badgeRadius: '9999px', shadow: '0 4px 14px -8px rgba(0,0,0,0.2)', transform: 'none', tracking: '0' };
}

/** Close `onClose` on outside click / Escape while `open`. */
export function useDismiss(open: boolean, ref: { readonly current: HTMLElement | null }, onClose: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ref, onClose]);
}

/* ------------------------------------------------------------- primitives */

function Panel({
  testId,
  kicker,
  title,
  tone = 'default',
  className,
  children,
}: {
  testId: string;
  kicker: string;
  title: string;
  tone?: 'default' | 'airo';
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const airo = tone === 'airo';
  return (
    <section
      data-testid={testId}
      className={`${PANEL} ${className ?? ''}`}
      style={airo ? { background: 'color-mix(in srgb, var(--color-ai) 6%, white)', borderColor: 'color-mix(in srgb, var(--color-ai) 22%, white)' } : undefined}
    >
      <div className="mb-2 min-w-0 leading-tight">
        <span className="block text-xs font-semibold uppercase tracking-[0.13em]" style={{ color: airo ? 'color-mix(in srgb, var(--color-ai) 70%, #888)' : undefined }}>
          {airo ? <span>{kicker}</span> : <text.span as="caption" emphasis="passive">{kicker}</text.span>}
        </span>
        <span className="block text-sm font-semibold leading-tight" style={{ color: airo ? AIRO : undefined }}>
          {airo ? title : <text.span className="text-intents-ux-box-foregroundColor">{title}</text.span>}
        </span>
      </div>
      {children}
    </section>
  );
}

/** Pantone-style colour chip: colour block + name/hex footer. Clicking it opens
 *  the browser's native colour picker (which already provides RGB / HEX entry),
 *  so no custom popover is needed. */
function ColorChip({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }): JSX.Element {
  const hex = normalizeHex(value);
  return (
    <label
      className="block w-full cursor-pointer overflow-hidden rounded-lg border border-intents-ux-box-borderColor text-left transition-transform hover:scale-[1.02]"
      aria-label={`Edit ${label} colour`}
    >
      <span className="block h-10" style={{ background: hex }} />
      <span className="block bg-intents-ux-box-backgroundColor px-2 py-1.5">
        <span className="block text-xs font-medium text-intents-ux-box-foregroundColor">{label}</span>
        <span className="block font-mono text-xs uppercase text-intents-ux-feedbackHighContrastPassive-feedbackColor">{hex.slice(1)}</span>
      </span>
      {/* Visually hidden — the wrapping label opens the native picker on click. */}
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="sr-only" aria-label={`Pick ${label} colour`} />
    </label>
  );
}

/* ------------------------------------------------------------------ panels */

export function DesignKitPanels({ appId }: { appId: string }): JSX.Element {
  const { data } = useBrandData(appId);

  const [palette, setPalette] = useState<Record<string, string>>({});
  const [paletteName, setPaletteName] = useState('Custom');
  const [headingName, setHeadingName] = useState('Inter');
  const [bodyName, setBodyName] = useState('Inter');
  const saveColorsRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paletteSig = COLOR_SLOTS.map((s) => data?.palette?.[s.key] ?? '').join('|');
  useEffect(() => {
    if (!data?.palette) return;
    const next: Record<string, string> = {};
    for (const s of COLOR_SLOTS) {
      const v = data.palette[s.key];
      if (typeof v === 'string') next[s.key] = v;
    }
    setPalette(next);
    if (data.palette.name) setPaletteName(data.palette.name);

  }, [paletteSig]);

  useEffect(() => {
    if (data?.typography?.heading?.family) setHeadingName(data.typography.heading.family);
    if (data?.typography?.body?.family) setBodyName(data.typography.body.family);
  }, [data?.typography?.heading?.family, data?.typography?.body?.family]);

  function handleColorChange(key: string, hex: string): void {
    const next = { ...palette, [key]: hex };
    setPalette(next);
    previewThemeInIframe(paletteName, next as unknown as CompletePalette);
    if (saveColorsRef.current) clearTimeout(saveColorsRef.current);
    saveColorsRef.current = setTimeout(() => {
      if (next.primary && next.background) void designKitApi.setColors(appId, paletteName, next);
    }, 450);
  }

  function applyFonts(heading: FontChoice, body: FontChoice): void {
    setHeadingName(heading.name);
    setBodyName(body.name);
    previewFontInIframe({ headerFont: heading, bodyFont: body });
    void designKitApi.setFonts(appId, heading, body);
  }

  return (
    <div data-testid="design-kit-panels" className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
      <ColorPanel palette={palette} paletteName={paletteName} onChange={handleColorChange} />
      <FontsPanel headingName={headingName} bodyName={bodyName} onApply={applyFonts} />
      <ImageVideoPanel appId={appId} keyword={data?.imagery?.keyword} moodImages={data?.imagery?.moodImages} />
      <LogoPanel appId={appId} />
      <VoicePanel appId={appId} voice={data?.voice} />
      <SummaryPanel text={data?.summary?.text} />
      <ElementsPanel className="md:col-span-2 lg:col-span-3" palette={palette} headingName={headingName} bodyName={bodyName} kitName={data?.kit?.name} />
    </div>
  );
}

export function ColorPanel({
  palette,
  paletteName,
  onChange,
}: {
  palette: Record<string, string>;
  paletteName: string;
  onChange: (key: string, hex: string) => void;
}): JSX.Element {
  return (
    <Panel testId="panel-color" kicker="Palette" title="Color">
      <div className="grid grid-cols-3 gap-2">
        {COLOR_SLOTS.map((slot) => (
          <ColorChip key={slot.key as string} label={slot.label} value={palette[slot.key as string] ?? '#cccccc'} onChange={(hex) => onChange(slot.key as string, hex)} />
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-intents-ux-box-borderColor pt-2">
        <text.span as="caption" emphasis="passive">Palette</text.span>
        <text.span as="caption" className="font-semibold">{paletteName}</text.span>
      </div>
    </Panel>
  );
}

export function FontsPanel({
  headingName,
  bodyName,
  onApply,
}: {
  headingName: string;
  bodyName: string;
  onApply: (heading: FontChoice, body: FontChoice) => void;
}): JSX.Element {
  return (
    <Panel testId="panel-fonts" kicker="Typography" title="Fonts">
      <FontPicker headingName={headingName} bodyName={bodyName} onApply={onApply} />
    </Panel>
  );
}

export function ImageVideoPanel({
  appId,
  keyword: incoming,
  moodImages = [],
}: {
  appId: string;
  keyword?: string;
  moodImages?: BrandDataMoodImage[];
}): JSX.Element {
  const [keyword, setKeyword] = useState(incoming ?? '');
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url ?? null;
  useEffect(() => { setKeyword(incoming ?? ''); }, [incoming]);
  return (
    <Panel testId="panel-imagery" kicker="Mood board" title="Imagery">
      {moodImages.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-1.5" data-testid="imagery-mood-grid">
          {moodImages.slice(0, 4).map((img) => (
            // Dynamic dev-supervisor slot URL — next/image can't optimize without a custom loader.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.slot} src={getSlotImageUrl(img.slot, img.url, previewBaseUrl)} alt="Brand mood" className="aspect-square w-full rounded-md border border-intents-ux-box-borderColor object-cover" />
          ))}
        </div>
      )}
      <input
        data-testid="imagery-input"
        className="w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-1.5 text-sm text-intents-ux-box-foregroundColor outline-none focus:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
        value={keyword}
        placeholder="e.g. morning light, breathwork, studio calm"
        onChange={(e) => setKeyword(e.target.value)}
        onBlur={() => void designKitApi.setImagery(appId, keyword)}
        aria-label="Imagery descriptor"
      />
    </Panel>
  );
}

export function LogoPanel({ appId }: { appId: string }): JSX.Element {
  const { manifest } = useMediaManifest({ appId });
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url ?? null;
  const [broken, setBroken] = useState(false);
  // Mirror the logo tool preview / brand book: when the user generates or selects a
  // logo in chat, those flows fire `logo-generated` / `logo-select` with the logo's
  // variant URLs. Prefer the same transparent-first variant the tool preview shows so
  // this panel and the tool preview never disagree; fall back to the saved slot.
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    function handleLogoEvent(event: Event): void {
      const logo = (event as CustomEvent).detail;
      const url = logo?.transparentUrl || logo?.horizontalTransparentUrl || logo?.verticalTransparentUrl;
      if (url) {
        setPreviewLogoUrl(url);
        setBroken(false);
      }
    }
    window.addEventListener('logo-select', handleLogoEvent);
    window.addEventListener('logo-generated', handleLogoEvent);
    return () => {
      window.removeEventListener('logo-select', handleLogoEvent);
      window.removeEventListener('logo-generated', handleLogoEvent);
    };
  }, []);
  const logoUrl = useMemo(() => {
    if (previewLogoUrl) return previewLogoUrl;
    for (const slot of LOGO_SLOT_NAMES) {
      const url = (manifest as Record<string, { currentUrl?: string } | undefined> | undefined)?.[slot]?.currentUrl;
      if (url) return getSlotImageUrl(slot, url, previewBaseUrl);
    }
    return null;
  }, [previewLogoUrl, manifest, previewBaseUrl]);
  return (
    <Panel testId="panel-logo" kicker="Identity" title="Logo">
      <div className="flex min-h-[88px] flex-1 items-center justify-center rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor p-3">
        {logoUrl && !broken ? (
          // Dynamic dev-supervisor / CDN slot URL — next/image can't optimize without a custom loader.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Primary logo" onError={() => setBroken(true)} className="max-h-20 max-w-full object-contain" />
        ) : (
          <text.span as="caption" emphasis="passive">Your logo will appear here</text.span>
        )}
      </div>
    </Panel>
  );
}

export function VoicePanel({
  appId,
  voice,
}: {
  appId: string;
  voice?: { weAre?: string[] };
}): JSX.Element {
  const incoming = (voice?.weAre ?? []).filter(Boolean);
  const [words, setWords] = useState<string[]>(incoming);
  const [draft, setDraft] = useState('');
  const sig = incoming.join('|');
  useEffect(() => { setWords(incoming.length ? incoming : []);   }, [sig]);

  function commit(next: string[]): void {
    setWords(next);
    void designKitApi.setVoice(appId, { weAre: next });
  }
  function add(): void {
    const w = draft.trim();
    if (!w) return;
    commit([...words, w]);
    setDraft('');
  }

  return (
    <Panel testId="panel-voice" kicker="Personality" title="Brand voice">
      <div className="flex flex-wrap items-center gap-1.5">
        {words.map((w, i) => (
          <span key={w + i} className="inline-flex items-center gap-1 rounded-full border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor py-0.5 pl-2.5 pr-1">
            <text.span as="caption" className="font-medium">{w}</text.span>
            <button type="button" aria-label={`Remove ${w}`} onClick={() => commit(words.filter((_, j) => j !== i))} className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-intents-ux-feedbackHighContrastPassive-feedbackColor hover:bg-intents-ux-box-backgroundColor">
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>
        ))}
      </div>
      <input
        data-testid="voice-input"
        value={draft}
        placeholder="Add a word — e.g. Unhurried"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        className="mt-2 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-2.5 py-1.5 text-sm text-intents-ux-box-foregroundColor outline-none focus:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
        aria-label="Add a brand voice word"
      />
    </Panel>
  );
}

/** Read-only, Airo-authored brand summary. Regenerates automatically when other
 *  brand elements change — no on-demand control (it is Airo's read of the brand). */
export function SummaryPanel({ text: summary }: { text?: string }): JSX.Element {
  return (
    <Panel testId="panel-summary" tone="airo" kicker="Airo's read" title="Brand summary">
      <p className="text-sm leading-relaxed" style={{ color: 'color-mix(in srgb, var(--color-ai) 88%, #1b1b20)' }}>
        {summary || 'Airo will summarise your brand here once the kit is assembled.'}
      </p>
    </Panel>
  );
}

export function ElementsPanel({
  palette,
  headingName,
  bodyName,
  kitName,
  className,
}: {
  palette: Record<string, string>;
  headingName: string;
  bodyName: string;
  kitName?: string;
  className?: string;
}): JSX.Element {
  const primary = normalizeHex(palette.primary ?? '#7C8B6B');
  const accent = normalizeHex(palette.accent ?? palette.secondary ?? primary);
  const bg = normalizeHex(palette.background ?? '#ffffff');
  // Element shapes come from a keyword heuristic over the kit name. (Exact
  // anchor.json shape tokens aren't surfaced to the frontend yet.)
  const s = kitShape(kitName);
  return (
    <Panel
      testId="panel-elements"
      className={className}
      kicker="Applied · live"
      title={`Elements in ${kitName ?? 'your kit'}`}
    >
      <div className="flex flex-wrap items-center gap-2.5" style={{ fontFamily: bodyName }}>
        <button type="button" className="px-4 py-2 text-sm font-semibold" style={{ background: primary, color: readableOn(primary), borderRadius: s.radius, boxShadow: s.shadow, textTransform: s.transform, letterSpacing: s.tracking }}>Primary action</button>
        <button type="button" className="border px-4 py-1.5 text-sm font-semibold" style={{ borderColor: primary, color: primary, borderRadius: s.radius, textTransform: s.transform, letterSpacing: s.tracking }}>Secondary</button>
        <span className="px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={{ background: `color-mix(in srgb, ${accent} 16%, white)`, color: accent, borderRadius: s.badgeRadius }}>Badge</span>
        <div className="px-3 py-2" style={{ background: bg, borderRadius: s.cardRadius, boxShadow: s.shadow, border: `1px solid color-mix(in srgb, ${primary} 16%, transparent)` }}>
          <span className="block text-base leading-tight" style={{ fontFamily: headingName, color: primary, textTransform: s.transform, letterSpacing: s.tracking }}>Card title</span>
          <span className="block text-xs" style={{ color: 'color-mix(in srgb, #1b1b20 60%, ' + bg + ')' }}>A card in your kit&rsquo;s shape.</span>
        </div>
        <span className="text-2xl" style={{ fontFamily: headingName, color: primary }}>Aa</span>
      </div>
    </Panel>
  );
}
