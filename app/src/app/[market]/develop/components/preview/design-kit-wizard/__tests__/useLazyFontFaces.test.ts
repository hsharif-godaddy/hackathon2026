// @vitest-environment jsdom
import { beforeEach,describe, expect, it } from 'vitest';

import { ensureFontFacesLoaded } from '../useLazyFontFaces';

function linkHrefs(): string[] {
  return Array.from(document.head.querySelectorAll('link[data-design-kit-font]')).map(
    (l) => (l as HTMLLinkElement).href,
  );
}

describe('ensureFontFacesLoaded', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('injects a stylesheet link for newly requested families', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter', 'Lora'], registry);
    const hrefs = linkHrefs();
    expect(hrefs).toHaveLength(1);
    expect(hrefs[0]).toContain('family=Inter');
    expect(hrefs[0]).toContain('family=Lora');
    expect(hrefs[0]).toContain('display=swap');
  });

  it('encodes spaces in family names as "+"', () => {
    ensureFontFacesLoaded(['Playfair Display'], new Set<string>());
    expect(linkHrefs()[0]).toContain('family=Playfair+Display');
  });

  it('does not re-request families already in the registry', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter'], registry);
    ensureFontFacesLoaded(['Inter'], registry); // already loaded
    expect(linkHrefs()).toHaveLength(1);
  });

  it('only requests the new families on a second call', () => {
    const registry = new Set<string>();
    ensureFontFacesLoaded(['Inter'], registry);
    ensureFontFacesLoaded(['Inter', 'Oswald'], registry);
    const hrefs = linkHrefs();
    expect(hrefs).toHaveLength(2);
    expect(hrefs[1]).toContain('family=Oswald');
    expect(hrefs[1]).not.toContain('family=Inter');
  });

  it('no-ops when given an empty list', () => {
    ensureFontFacesLoaded([], new Set<string>());
    expect(linkHrefs()).toHaveLength(0);
  });
});
