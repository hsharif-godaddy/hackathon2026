// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { GoogleFontEntry } from '@airo/shared/fonts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { buildTagGroups,filterByTags, FontPicker, visibleRange } from '../FontPicker';

// Deterministic catalog: keep FONT_THEMES (and everything else) real via
// importOriginal, but stub loadGoogleFontsCatalog with a tiny, fixed fixture so
// the comboboxes render a predictable list and tag-filter interactions are stable.
// `vi.mock` is hoisted above module scope, so the fixture is defined via
// `vi.hoisted` to be available inside the (also-hoisted) factory.
const { CATALOG_FIXTURE } = vi.hoisted(() => ({
  CATALOG_FIXTURE: [
    { family: 'Lora', category: 'serif', weights: ['400', '500', '600'], tags: ['Feeling/Calm', 'Serif/Modern'] },
    { family: 'Montserrat', category: 'sans-serif', weights: ['600', '700'], tags: ['Feeling/Business', 'Sans Serif/Geometric'] },
    { family: 'Merriweather', category: 'serif', weights: ['700', '900'], tags: ['Serif/Old Style'] },
  ] as GoogleFontEntry[],
}));

vi.mock('@airo/shared/fonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@airo/shared/fonts')>()),
  loadGoogleFontsCatalog: vi.fn().mockResolvedValue(CATALOG_FIXTURE),
}));

describe('visibleRange', () => {
  it('renders only a bounded window even for a huge list', () => {
    const [start, end] = visibleRange(1800, 0, 224, 40, 5);
    expect(start).toBe(0);
    expect(end - start).toBeLessThanOrEqual(20);
  });

  it('shifts the window as the list is scrolled', () => {
    const [start, end] = visibleRange(1800, 4000, 224, 40, 5);
    expect(start).toBeGreaterThan(80);
    expect(end - start).toBeLessThanOrEqual(20);
  });

  it('returns an empty range for an empty list', () => {
    expect(visibleRange(0, 0, 224, 40, 5)).toEqual([0, 0]);
  });
});

describe('filterByTags', () => {
  const entries: GoogleFontEntry[] = [
    { family: 'A', category: 'serif', weights: ['400'], tags: ['Feeling/Calm', 'Serif/Modern'] },
    { family: 'B', category: 'sans-serif', weights: ['400'], tags: ['Feeling/Business'] },
    { family: 'C', category: 'serif', weights: ['400'], tags: ['Feeling/Calm'] },
    { family: 'D', category: 'sans-serif', weights: ['400'], tags: [] },
  ];

  it('ORs within a group: two Feeling tags match a font having either', () => {
    const result = filterByTags(entries, ['Feeling/Calm', 'Feeling/Business']);
    expect(result.map((e) => e.family)).toEqual(['A', 'B', 'C']);
  });

  it('ANDs across groups: a Feeling tag + a Serif tag requires both', () => {
    const result = filterByTags(entries, ['Feeling/Calm', 'Serif/Modern']);
    expect(result.map((e) => e.family)).toEqual(['A']);
  });

  it('returns all entries for an empty selection', () => {
    expect(filterByTags(entries, [])).toBe(entries);
  });
});

describe('buildTagGroups', () => {
  it('returns the present groups in canonical order with deduped, sorted tags', () => {
    const catalog: GoogleFontEntry[] = [
      { family: 'A', category: 'serif', weights: ['400'], tags: ['Sans Serif/Geometric', 'Feeling/Calm'] },
      { family: 'B', category: 'serif', weights: ['400'], tags: ['Serif/Modern', 'Feeling/Business'] },
      { family: 'C', category: 'serif', weights: ['400'], tags: ['Feeling/Calm', 'Calligraphy/Formal'] },
      // a tag in a group that should be dropped (not in GROUP_ORDER)
      { family: 'D', category: 'serif', weights: ['400'], tags: ['Purpose/Reading'] },
    ];
    const groups = buildTagGroups(catalog);
    expect(groups.map((g) => g.label)).toEqual(['Feeling', 'Calligraphy', 'Serif', 'Sans Serif']);
    expect(groups.find((g) => g.label === 'Feeling')!.tags).toEqual([
      'Feeling/Business',
      'Feeling/Calm',
    ]);
  });
});

describe('FontPicker', () => {
  it('applies both fonts (with curated weights) when a pairing chip is clicked', () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('pairing-modern-professional'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Montserrat', weights: ['600', '700'], category: 'sans-serif' },
      { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
    );
  });

  it('selecting a curated heading font reports it with its real weights, body unchanged', async () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('heading-font-select'));
    // Wait for the catalog (which contains Merriweather) to load and render.
    fireEvent.click(await screen.findByText('Merriweather'));

    expect(onApply).toHaveBeenCalledWith(
      { name: 'Merriweather', weights: ['700', '900'], category: 'serif' },
      { name: 'Inter', weights: ['400', '500', '600'], category: 'sans-serif' },
    );
  });

  it('narrows the list to fonts matching a selected Feeling/Calm tag', async () => {
    const onApply = vi.fn();
    render(<FontPicker headingName="Inter" bodyName="Inter" onApply={onApply} />);

    fireEvent.click(screen.getByTestId('body-font-select'));

    // Catalog resolves -> Filters toggle appears (only when groups are present).
    const filtersToggle = await screen.findByTestId('body-font-select-filters-toggle');
    fireEvent.click(filtersToggle);

    // Toggle the "Calm" chip (Feeling/Calm -> label shows the tag after the slash).
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));

    // Only Lora carries Feeling/Calm; Montserrat and Merriweather drop out.
    await waitFor(() => {
      expect(screen.getByText('Lora')).toBeInTheDocument();
    });
    expect(screen.queryByText('Montserrat')).not.toBeInTheDocument();
    expect(screen.queryByText('Merriweather')).not.toBeInTheDocument();
  });
});
