'use client';

import type { JSX, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandDataMoodImage } from '@airo/shared/brand-data';
import Button from '@ux/button';
import Card from '@ux/card';
import text from '@ux/text';

import { getSlotImageUrl } from '@/app/[market]/develop/components/media/MediaSlotDetail';
import type { CompletePalette } from '@/app/[market]/develop/components/types/colorScheme';
import { previewFontInIframe } from '@/app/[market]/develop/components/utils/previewFontInIframe';
import { previewThemeInIframe } from '@/app/[market]/develop/components/utils/previewThemeInIframe';
import { dynamicApiConfigService } from '@/config/dynamic-api';
import { useMediaManifest } from '@/hooks/useMediaManifest';
import { useTranslations } from '@/hooks/useTranslations';
import { regenerateToken } from '@/lib/jwt-regeneration';
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useServerPollingStore } from '@/stores/useServerPollingStore';
import { compressImageFile } from '@/utils/image-compression';
import { designKitApi, type FontChoice } from './designKitApi';
import { DESIGN_KIT_EID, fireDesignKitAction, fireDesignKitClick, fireDesignKitImpression } from './designKitEvents';
import { FontPicker } from './FontPicker';
import type { BrandDataPalette } from './useBrandData';
import { useBrandData } from './useBrandData';

/**
 * The customer-editable **Brand Design Kit** — the live content of the Brand tab
 * (`ViewMode.BRAND`) once the build is finished. A page header over a
 * three-column grouped grid (Figma node 8419-5609): every element is editable in
 * place — Pantone-style colour chips with the native picker, Figma-style font
 * pickers with live specimens + curated pairings, a combined Logo & Mood Board
 * card with customer logo upload, editable brand voice, kit-shaped element
 * previews, and a read-only Airo-authored brand summary. The chrome is
 * Airo-branded (`--color-ai`); the user's brand colours fill content.
 */

const COLOR_SLOTS: Array<{ key: keyof BrandDataPalette; label: string }> = [
  { key: 'primary', label: 'Primary' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'muted', label: 'Muted' },
];

const LOGO_SLOT_NAMES = ['logo/primary', 'logo/horizontal', 'logo/vertical'] as const;

/** Slots a customer logo upload targets, in priority order. The generator usually
 *  creates `logo/horizontal` (not `logo/primary`), and the media slot-upload route
 *  404s on a slot that doesn't exist — so try horizontal first, then primary. */
const LOGO_UPLOAD_SLOTS = ['logo/horizontal', 'logo/primary'] as const;
/** SVG is intentionally excluded: the media pipeline rejects it (and it's an
 *  unsanitised XSS vector). PNG/JPG/WEBP only. */
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_LOGO_SIZE = 25 * 1024 * 1024; // 25MB

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

/** Card matching the Settings tabs (ProjectActionCard): @ux/card with the standard
 *  space + a `text.span as="title"` heading, so the Brand kit reads as the same surface. */
function Panel({
  testId,
  title,
  tone = 'default',
  className,
  children,
}: {
  testId: string;
  title: string;
  tone?: 'default' | 'airo';
  className?: string;
  children: ReactNode;
}): JSX.Element {
  // `tone="airo"` keeps the Brand summary on the Airo-purple (`--color-ai`) treatment.
  const airo = tone === 'airo';
  return (
    <Card
      data-testid={testId}
      space={{ gap: 'sm', block: 'md', inline: 'md' }}
      // Airo-purple tint for the Brand summary. Use !-important Tailwind arbitrary
      // values (not Card's style prop, which doesn't reach the card surface) so the
      // purple bg/border reliably override @ux/card's own background.
      className={`${airo ? '!border-[color-mix(in_srgb,var(--color-ai)_22%,white)] !bg-[color-mix(in_srgb,var(--color-ai)_8%,white)]' : ''} ${className ?? ''}`}
    >
      <text.span as="title" size={-1} className="mb-3 block" style={airo ? { color: 'var(--color-ai)' } : undefined}>{title}</text.span>
      <div className="flex flex-col">{children}</div>
    </Card>
  );
}

/** Small grey field caption (Figma: "Buttons", "Badge", "Headline text", "Recommended"). */
function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <text.span as="caption" size={-1} emphasis="passive" className="mb-1.5 block">{children}</text.span>;
}

/** Pantone-style colour chip: a square swatch with the role NAME + HEX overlaid
 *  inside it. The label colour inverts against the swatch (readableOn) so it stays
 *  legible on any background. Clicking opens the browser's native colour picker. */
function ColorChip({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }): JSX.Element {
  const hex = normalizeHex(value);
  const labelColor = readableOn(hex);
  return (
    <label
      className="relative flex aspect-square w-full cursor-pointer flex-col justify-end overflow-hidden rounded-xl border border-intents-ux-box-borderColor p-2 transition-transform hover:scale-[1.02]"
      style={{ background: hex }}
      aria-label={`Edit ${label} colour`}
    >
      <span className="text-xs font-semibold leading-tight" style={{ color: labelColor }}>{label}</span>
      <span className="font-mono text-[11px] uppercase leading-tight" style={{ color: labelColor, opacity: 0.8 }}>{hex.slice(1)}</span>
      {/* Visually hidden — the wrapping label opens the native picker on click. */}
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="sr-only" aria-label={`Pick ${label} colour`} />
    </label>
  );
}

/* ------------------------------------------------------------------ panels */

export function DesignKitPanels({ appId }: { appId: string }): JSX.Element {
  const t = useTranslations();
  // Match BrandBookView: wait for develop-page hydration before hitting the agent.
  // Calling /brand-data before the app/alloc exists returns 401 and floods retries.
  const isAppHydrated = useDevelopPageStore(
    (state) => state.currentAppId === appId && state.loadingPhase === 'ready',
  );
  const { data } = useBrandData(appId, { enabled: isAppHydrated });

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
      if (next.primary && next.background) {
        void designKitApi.setColors(appId, paletteName, next);
        fireDesignKitAction(DESIGN_KIT_EID.brandColor, 'load', { element: 'color', source: 'direct', trigger: 'color_input' });
      }
    }, 450);
  }

  function applyFonts(heading: FontChoice, body: FontChoice): void {
    const changed = heading.name !== headingName || body.name !== bodyName;
    setHeadingName(heading.name);
    setBodyName(body.name);
    previewFontInIframe({ headerFont: heading, bodyFont: body });
    void designKitApi.setFonts(appId, heading, body);
    if (changed) {
      fireDesignKitAction(DESIGN_KIT_EID.brandFonts, 'load', { element: 'fonts', source: 'direct', trigger: 'apply' });
    }
  }

  return (
    <div
      data-testid="design-kit-panels"
      className="h-full overflow-y-auto bg-intents-ux-box-backgroundColor p-2.5"
    >
      <div className="mx-auto w-full px-1.5 pb-2 md:max-w-7xl md:px-0.5">
        {/* Heading matches SettingsSection (General / Model Override): text.h3 as="title" + text.p. */}
        <header className="mb-4 flex flex-col gap-1">
          <text.h3 as="title">{t('builder_brandkit_title')}</text.h3>
          <text.p>{t('builder_brandkit_subtitle')}</text.p>
        </header>
        {/* Three-column grouped layout (Figma): Color+Elements | Fonts+Voice | Logo&Mood+Summary.
            Columns collapse to a single stack below lg. */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3 lg:items-start">
          <div className="flex flex-col gap-3">
            <ColorPanel palette={palette} onChange={handleColorChange} />
            <ElementsPanel palette={palette} headingName={headingName} bodyName={bodyName} kitName={data?.kit?.name} />
          </div>
          <div className="flex flex-col gap-3">
            <FontsPanel headingName={headingName} bodyName={bodyName} onApply={applyFonts} />
            <VoicePanel appId={appId} voice={data?.voice} />
          </div>
          <div className="flex flex-col gap-3">
            <LogoMoodBoardPanel appId={appId} keyword={data?.imagery?.keyword} moodImages={data?.imagery?.moodImages} />
            <SummaryPanel text={data?.summary?.text} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ColorPanel({
  palette,
  onChange,
}: {
  palette: Record<string, string>;
  onChange: (key: string, hex: string) => void;
}): JSX.Element {
  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.brandColor, { element: 'color' });
  }, []);

  return (
    <Panel testId="panel-color" title="Color Palette">
      <div className="grid grid-cols-3 gap-3">
        {COLOR_SLOTS.map((slot) => (
          <ColorChip key={slot.key as string} label={slot.label} value={palette[slot.key as string] ?? '#cccccc'} onChange={(hex) => onChange(slot.key as string, hex)} />
        ))}
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
  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.brandFonts, { element: 'fonts' });
  }, []);

  return (
    <Panel testId="panel-fonts" title="Fonts">
      <FontPicker headingName={headingName} bodyName={bodyName} onApply={onApply} />
    </Panel>
  );
}

/**
 * Combined **Logo & Mood Board** card (Figma): the primary logo on a dark panel
 * with a customer upload affordance, a 2×2 mood-image grid, and an editable
 * mood-board caption (the imagery descriptor). Replaces the prior separate
 * `LogoPanel` (display-only) and `ImageVideoPanel` cards.
 */
export function LogoMoodBoardPanel({
  appId,
  keyword: incomingKeyword,
  moodImages = [],
}: {
  appId: string;
  keyword?: string;
  moodImages?: BrandDataMoodImage[];
}): JSX.Element {
  const { manifest, refetch } = useMediaManifest({ appId });
  const previewBaseUrl = useServerPollingStore((state) => state.getServerState(appId))?.url ?? null;
  const [broken, setBroken] = useState(false);
  // Mirror the logo tool preview: when the user generates or selects a logo in
  // chat, those flows fire `logo-generated` / `logo-select` with the logo's
  // variant URLs. Prefer the same transparent-first variant; fall back to the
  // saved slot from the manifest.
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);
  const [keyword, setKeyword] = useState(incomingKeyword ?? '');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setKeyword(incomingKeyword ?? ''); }, [incomingKeyword]);

  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.brandLogo, { element: 'logo' });
    fireDesignKitImpression(DESIGN_KIT_EID.brandImagery, { element: 'imagery' });

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

  // Upload a customer logo, reusing the media slot-upload endpoint, then refetch the
  // manifest so the displayed logo (and the preview's slot proxy) pick up the new image.
  // The route 404s on a slot that doesn't exist and the generator usually only creates
  // `logo/horizontal`, so try the logo slots in priority order: a 404 means "not this
  // slot, try the next"; any other non-OK status is a real failure.
  const uploadLogo = useCallback(async (file: File): Promise<void> => {
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setUploadError('Upload a PNG, JPG or WEBP logo');
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      setUploadError('Logo must be under 25MB');
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const [compressed, tokenResult, apiConfig] = await Promise.all([
        compressImageFile(file),
        regenerateToken({ siteId: appId, force: true }),
        dynamicApiConfigService.getConfigForSite(appId),
      ]);
      if (!apiConfig.agentUrl) throw new Error('Agent URL not available');
      const baseAgentUrl = apiConfig.agentUrl.replace(`/apps/${appId}`, '');

      let uploaded = false;
      for (const slot of LOGO_UPLOAD_SLOTS) {
        const formData = new FormData();
        formData.append('image', compressed);
        const response = await fetch(`${baseAgentUrl}/media/${appId}/slots/${slot}/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokenResult.token}` },
          body: formData,
        });
        if (response.ok) { uploaded = true; break; }
        if (response.status !== 404) throw new Error(`Logo upload failed (${response.status})`);
      }
      if (!uploaded) throw new Error('No logo slot available to upload to');
      logger.info('designKit.logoUpload.success', { appId });
      fireDesignKitAction(DESIGN_KIT_EID.brandLogo, 'load', { element: 'logo', source: 'direct', trigger: 'upload' });
      setBroken(false);
      setPreviewLogoUrl(null); // let the refreshed manifest drive the displayed logo
      await refetch();
    } catch (err) {
      logger.error('designKit.logoUpload.failed', { appId, error: err instanceof Error ? err.message : String(err) });
      setUploadError(err instanceof Error ? err.message : 'Logo upload failed');
    } finally {
      setIsUploading(false);
    }
  }, [appId, refetch]);

  return (
    <Panel testId="panel-logo" title="Logo & Mood Board">
      <div className="relative flex min-h-[150px] items-center justify-center overflow-hidden rounded-xl p-5" style={{ background: '#15171a' }}>
        {logoUrl && !broken ? (
          // Dynamic dev-supervisor / CDN slot URL — next/image can't optimize without a custom loader.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Primary logo" onError={() => setBroken(true)} className="max-h-28 max-w-full object-contain" />
        ) : (
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>Your logo will appear here</span>
        )}
        <div className="absolute bottom-2.5 right-2.5">
          <Button
            data-testid="logo-upload-button"
            design="secondary"
            size="sm"
            onClick={() => {
              fireDesignKitClick(DESIGN_KIT_EID.logoUpload, { element: 'logo', source: 'direct' });
              fileInputRef.current?.click();
            }}
            disabled={isUploading}
            text={isUploading ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          data-testid="logo-upload-input"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadLogo(file);
            e.target.value = '';
          }}
          aria-label="Upload logo"
        />
      </div>
      {uploadError && (
        <text.span as="caption" className="mt-1.5 block text-intents-ux-feedbackHighContrastCritical-feedbackColor">{uploadError}</text.span>
      )}

      {moodImages.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2" data-testid="imagery-mood-grid">
          {moodImages.slice(0, 4).map((img) => (
            // Dynamic dev-supervisor slot URL — next/image can't optimize without a custom loader.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.slot} src={getSlotImageUrl(img.slot, img.url, previewBaseUrl)} alt="Brand mood" className="aspect-square w-full rounded-lg border border-intents-ux-box-borderColor object-cover" />
          ))}
        </div>
      )}

      <input
        data-testid="imagery-input"
        className="mt-3 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-3 py-2 text-sm text-intents-ux-box-foregroundColor outline-none focus:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
        value={keyword}
        placeholder="Mood board caption — e.g. minimal neutral fashion lifestyle"
        onChange={(e) => setKeyword(e.target.value)}
        onBlur={() => {
          if (keyword === (incomingKeyword ?? '')) return;
          void designKitApi.setImagery(appId, keyword);
          fireDesignKitAction(DESIGN_KIT_EID.brandImagery, 'load', { element: 'imagery', source: 'direct', trigger: 'blur' });
        }}
        aria-label="Mood board caption"
      />
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
  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.brandVoice, { element: 'voice' });
  }, []);

  const incoming = (voice?.weAre ?? []).filter(Boolean);
  const [words, setWords] = useState<string[]>(incoming);
  const [draft, setDraft] = useState('');
  const sig = incoming.join('|');
  useEffect(() => { setWords(incoming.length ? incoming : []);   }, [sig]);

  function commit(next: string[], trigger: 'add' | 'remove'): void {
    setWords(next);
    void designKitApi.setVoice(appId, { weAre: next });
    fireDesignKitAction(DESIGN_KIT_EID.brandVoice, 'load', { element: 'voice', source: 'direct', trigger, count: next.length });
  }
  function add(): void {
    const w = draft.trim();
    if (!w) return;
    commit([...words, w], 'add');
    setDraft('');
  }

  return (
    <Panel testId="panel-voice" title="Brand voice">
      <input
        data-testid="voice-input"
        value={draft}
        placeholder="Add a word…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        className="w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor px-3 py-2 text-sm text-intents-ux-box-foregroundColor outline-none focus:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]"
        aria-label="Add a brand voice word"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {words.map((w, i) => (
          <span key={w + i} className="inline-flex items-center gap-1 rounded-full border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor py-1 pl-3 pr-1.5">
            <text.span as="caption" className="font-medium">{w}</text.span>
            <button type="button" aria-label={`Remove ${w}`} onClick={() => commit(words.filter((_, j) => j !== i), 'remove')} className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-intents-ux-feedbackHighContrastPassive-feedbackColor hover:bg-intents-ux-boxLowContrast-backgroundColor">
              <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>
        ))}
      </div>
    </Panel>
  );
}

/** Read-only, Airo-authored brand summary. Regenerates automatically when other
 *  brand elements change — no on-demand control (it is Airo's read of the brand). */
export function SummaryPanel({ text: summary }: { text?: string }): JSX.Element {
  useEffect(() => {
    fireDesignKitImpression(DESIGN_KIT_EID.brandSummary, { element: 'summary' });
  }, []);

  return (
    <Panel testId="panel-summary" tone="airo" title="Brand summary">
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
    <Panel testId="panel-elements" className={className} title="Elements">
      <div className="flex flex-wrap gap-5" style={{ fontFamily: bodyName }}>
        <div className="min-w-[150px] flex-1">
          <FieldLabel>Buttons</FieldLabel>
          <div className="flex flex-col items-stretch gap-2">
            <button type="button" className="px-4 py-2 text-sm font-semibold" style={{ background: primary, color: readableOn(primary), borderRadius: s.radius, boxShadow: s.shadow, textTransform: s.transform, letterSpacing: s.tracking }}>Primary</button>
            <button type="button" className="px-4 py-2 text-sm font-semibold" style={{ background: `color-mix(in srgb, ${primary} 12%, white)`, color: primary, borderRadius: s.radius, textTransform: s.transform, letterSpacing: s.tracking }}>Secondary</button>
          </div>
        </div>
        <div>
          <FieldLabel>Badge</FieldLabel>
          <span className="inline-block px-2.5 py-1 text-xs font-bold uppercase tracking-wide" style={{ background: `color-mix(in srgb, ${accent} 16%, white)`, color: accent, borderRadius: s.badgeRadius }}>Badge</span>
        </div>
      </div>
      <div className="mt-4">
        <FieldLabel>Card</FieldLabel>
        <div className="px-4 py-3" style={{ background: bg, borderRadius: s.cardRadius, boxShadow: s.shadow, border: `1px solid color-mix(in srgb, ${primary} 16%, transparent)` }}>
          <span className="block text-base leading-tight" style={{ fontFamily: headingName, color: primary, textTransform: s.transform, letterSpacing: s.tracking }}>Card Title</span>
          <span className="block text-xs" style={{ color: 'color-mix(in srgb, #1b1b20 60%, ' + bg + ')' }}>A card in your kit&rsquo;s shape.</span>
        </div>
      </div>
    </Panel>
  );
}
