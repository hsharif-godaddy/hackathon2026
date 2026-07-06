import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { FONT_THEMES, type FontInfo, type GoogleFontEntry, loadGoogleFontsCatalog, TAG_EXAMPLE_FONT_FAMILIES,TAG_EXAMPLE_FONTS } from '@airo/shared/fonts';
import Button from '@ux/button';

import type { FontChoice } from './designKitApi';
import { DESIGN_KIT_EID, fireDesignKitAction, fireDesignKitClick } from './designKitEvents';
import { useDismiss } from './DesignKitPanels';
import { ensureTagExampleFontsLoaded, useLazyFontFaces } from './useLazyFontFaces';

const ROW_HEIGHT = 40;
const VIEWPORT_HEIGHT = 224;
const OVERSCAN = 5;
const AIRO = 'var(--color-ai)';

/** Curated fonts derived from FONT_THEMES (first occurrence wins for weights). */
const CURATED_BY_NAME: Map<string, FontInfo> = (() => {
  const m = new Map<string, FontInfo>();
  for (const theme of Object.values(FONT_THEMES)) {
    if (!m.has(theme.headerFont.name)) m.set(theme.headerFont.name, theme.headerFont);
    if (!m.has(theme.bodyFont.name)) m.set(theme.bodyFont.name, theme.bodyFont);
  }
  return m;
})();
const CURATED_NAMES: string[] = [...CURATED_BY_NAME.keys()];

/** Resolve a family name to a FontChoice: curated weights win, then catalog, then a safe default. */
function resolveFont(family: string, catalog: GoogleFontEntry[] | null): FontChoice {
  const curated = CURATED_BY_NAME.get(family);
  if (curated) return curated;
  const entry = catalog?.find((e) => e.family === family);
  if (entry) return { name: entry.family, weights: entry.weights, category: entry.category };
  return { name: family, weights: ['400', '700'], category: 'sans-serif' };
}

/** GF discovery groups in display order. Tags are canonical "Label/Tag" strings. */
const GROUP_ORDER = ['Feeling', 'Appearance', 'Calligraphy', 'Serif', 'Sans Serif'];

/** Build the ordered, deduped tag groups present in the catalog for the filter UI. */
export function buildTagGroups(catalog: GoogleFontEntry[]): Array<{ label: string; tags: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const e of catalog) {
    for (const t of e.tags) {
      const label = t.slice(0, t.indexOf('/'));
      if (!GROUP_ORDER.includes(label)) continue;
      if (!map.has(label)) map.set(label, new Set());
      map.get(label)!.add(t);
    }
  }
  return GROUP_ORDER.filter((l) => map.has(l)).map((l) => ({ label: l, tags: [...map.get(l)!].sort() }));
}

/** OR within a group, AND across groups. Empty selection passes everything through. */
export function filterByTags(entries: GoogleFontEntry[], selected: string[]): GoogleFontEntry[] {
  if (selected.length === 0) return entries;
  const byGroup = new Map<string, string[]>();
  for (const t of selected) {
    const g = t.slice(0, t.indexOf('/'));
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(t);
  }
  return entries.filter((e) => {
    const tagSet = new Set(e.tags);
    for (const groupTags of byGroup.values()) {
      if (!groupTags.some((t) => tagSet.has(t))) return false;
    }
    return true;
  });
}

/** Pure windowing: [start, end) of rows to render for the current scroll position. */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): [number, number] {
  if (count === 0) return [0, 0];
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(count, start + visibleRows);
  return [start, end];
}

function Combobox({
  value,
  testId,
  catalog,
  onOpen,
  onSelect,
}: {
  value: string;
  testId: string;
  catalog: GoogleFontEntry[] | null;
  onOpen: () => void;
  onSelect: (family: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const requestFonts = useLazyFontFaces();
  const picker: 'heading' | 'body' = testId.startsWith('heading') ? 'heading' : 'body';
  useDismiss(open, ref, () => setOpen(false));

  const groups = catalog ? buildTagGroups(catalog) : [];
  const q = query.trim().toLowerCase();
  const tagFiltered = catalog ? filterByTags(catalog, selectedTags).map((e) => e.family) : CURATED_NAMES;
  const filtered = q ? tagFiltered.filter((f) => f.toLowerCase().includes(q)) : tagFiltered;
  const [start, end] = visibleRange(filtered.length, scrollTop, VIEWPORT_HEIGHT, ROW_HEIGHT, OVERSCAN);
  const windowed = filtered.slice(start, end);

  useEffect(() => {
    if (open) requestFonts(windowed);
  }, [open, requestFonts, windowed.join(',')]);

  function toggleTag(tag: string): void {
    setScrollTop(0);
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            fireDesignKitAction(DESIGN_KIT_EID.fontPicker, 'load', { picker });
          }
          setOpen((o) => !o);
          setQuery('');
          setScrollTop(0);
          onOpen();
        }}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md text-left transition-colors"
      >
        <span className="min-w-0 truncate text-2xl leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: value }}>{value}</span>
        <svg viewBox="0 0 24 24" className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#9a9aa3' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-intents-ux-box-borderColor bg-intents-ux-box-backgroundColor p-1.5 shadow-[0_12px_32px_-8px_rgba(24,24,30,0.28)]">
          <div className="mb-1 flex items-center gap-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setScrollTop(0); }}
              placeholder="Search fonts"
              aria-label="Search fonts"
              className="w-full rounded-md border border-intents-ux-box-borderColor bg-intents-ux-boxLowContrast-backgroundColor px-2.5 py-2 text-xs text-intents-ux-box-foregroundColor outline-none"
            />
            {groups.length > 0 && (
              <button
                type="button"
                data-testid={`${testId}-filters-toggle`}
                aria-expanded={filtersOpen}
                onClick={() => {
                  const next = !filtersOpen;
                  fireDesignKitClick(DESIGN_KIT_EID.fontFilter, { picker, expanded: next });
                  setFiltersOpen(next);
                }}
                className={`shrink-0 rounded-md border px-2 py-2 text-xs transition-colors ${selectedTags.length ? 'border-[color-mix(in_srgb,var(--color-ai)_55%,transparent)] text-intents-ux-box-foregroundColor' : 'border-intents-ux-box-borderColor text-intents-ux-boxPassive-foregroundColor'}`}
              >
                Filters{selectedTags.length ? ` (${selectedTags.length})` : ''} ▾
              </button>
            )}
          </div>
          {filtersOpen && groups.length > 0 && (
            <div data-testid={`${testId}-filters`} className="mb-1 max-h-40 overflow-auto rounded-md border border-intents-ux-box-borderColor p-1.5">
              {selectedTags.length > 0 && (
                <button type="button" onClick={() => { setSelectedTags([]); setScrollTop(0); }} className="mb-1 text-[11px] text-intents-ux-link-foregroundColor underline">
                  Clear {selectedTags.length}
                </button>
              )}
              {groups.map((group) => (
                <div key={group.label} className="mb-1.5 last:mb-0">
                  <span className="mb-1 block text-[10px] uppercase tracking-[0.1em] text-intents-ux-boxPassive-foregroundColor">{group.label}</span>
                  <div className="flex flex-wrap gap-1">
                    {group.tags.map((tag) => {
                      const on = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            fireDesignKitClick(DESIGN_KIT_EID.fontFilter, { picker, filter: tag });
                            toggleTag(tag);
                          }}
                          // Render the label in a font that exemplifies the tag (à la the
                          // Google Fonts sidebar). Falls back to inherited font if unmapped.
                          style={{ fontFamily: TAG_EXAMPLE_FONTS[tag] }}
                          className={`rounded-full border px-2 py-0.5 text-[13px] leading-tight transition-colors ${on ? 'border-transparent bg-[color-mix(in_srgb,var(--color-ai)_18%,transparent)] text-intents-ux-box-foregroundColor' : 'border-intents-ux-box-borderColor text-intents-ux-boxPassive-foregroundColor hover:border-[color-mix(in_srgb,var(--color-ai)_45%,transparent)]'}`}
                        >
                          {tag.slice(tag.indexOf('/') + 1)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <ul
            role="listbox"
            onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
            style={{ height: VIEWPORT_HEIGHT, overflowY: 'auto' }}
          >
            <li aria-hidden style={{ height: start * ROW_HEIGHT }} />
            {windowed.map((opt) => {
              const selected = opt === value;
              return (
                <li key={opt} role="option" aria-selected={selected} style={{ height: ROW_HEIGHT }}>
                  <button
                    type="button"
                    onClick={() => {
                      fireDesignKitAction(DESIGN_KIT_EID.fontPicker, 'load', { picker, font_family: opt });
                      onSelect(opt);
                      setOpen(false);
                    }}
                    className={`flex h-full w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-left transition-colors hover:bg-intents-ux-boxLowContrast-backgroundColor ${selected ? 'bg-intents-ux-boxLowContrast-backgroundColor' : ''}`}
                  >
                    <span className="truncate text-base leading-none text-intents-ux-box-foregroundColor" style={{ fontFamily: opt }}>{opt}</span>
                    {selected && <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: AIRO }}><path d="M5 13l4 4L19 7" /></svg>}
                  </button>
                </li>
              );
            })}
            <li aria-hidden style={{ height: Math.max(0, filtered.length - end) * ROW_HEIGHT }} />
            {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-intents-ux-feedbackHighContrastPassive-feedbackColor">No fonts match.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Hybrid font picker: curated FONT_THEMES pairings (one-click apply both) plus
 * heading/body comboboxes searchable over the full Google Fonts catalog (lazily
 * loaded on first open, windowed so 1000+ fonts never mount at once).
 */
export function FontPicker({
  headingName,
  bodyName,
  onApply,
}: {
  headingName: string;
  bodyName: string;
  onApply: (heading: FontChoice, body: FontChoice) => void;
}): JSX.Element {
  const [catalog, setCatalog] = useState<GoogleFontEntry[] | null>(null);
  const loadingRef = useRef(false);

  // Preload the filter-chip example fonts once (single request, fixed set).
  useEffect(() => { ensureTagExampleFontsLoaded(TAG_EXAMPLE_FONT_FAMILIES); }, []);

  function loadCatalog(): void {
    if (catalog || loadingRef.current) return;
    loadingRef.current = true;
    void loadGoogleFontsCatalog().then(setCatalog).catch(() => { loadingRef.current = false; });
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="mb-1 block text-xs font-medium text-intents-ux-boxPassive-foregroundColor">Headline text</span>
        <Combobox
          testId="heading-font-select"
          value={headingName}
          catalog={catalog}
          onOpen={loadCatalog}
          onSelect={(family) => onApply(resolveFont(family, catalog), resolveFont(bodyName, catalog))}
        />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-intents-ux-boxPassive-foregroundColor">Body text</span>
        <Combobox
          testId="body-font-select"
          value={bodyName}
          catalog={catalog}
          onOpen={loadCatalog}
          onSelect={(family) => onApply(resolveFont(headingName, catalog), resolveFont(family, catalog))}
        />
      </div>

      {/* Curated one-click pairings (Figma "Recommended") — set both fonts at once. */}
      <div>
        <span className="mb-1.5 block text-xs font-medium text-intents-ux-boxPassive-foregroundColor">Recommended</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(FONT_THEMES).map(([id, theme]) => (
            <Button
              key={id}
              data-testid={`pairing-${id}`}
              design="secondary"
              size="sm"
              onClick={() => {
                fireDesignKitAction(DESIGN_KIT_EID.fontPairing, 'load', {
                  pairing_id: id,
                  heading_font: theme.headerFont.name,
                  body_font: theme.bodyFont.name,
                });
                onApply(theme.headerFont, theme.bodyFont);
              }}
              text={theme.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
