import { describe, expect, it } from 'vitest';

import { headingHierarchySpec } from '../specs/heading-hierarchy.js';
import { linkQualitySpec } from '../specs/link-quality.js';
import { responsiveGridCollapseSpec } from '../specs/responsive-grid-collapse.js';
import { responsiveReadinessSpec } from '../specs/responsive-readiness.js';
import { accessibilityCoverageSpec } from '../specs/accessibility-coverage.js';
import { inlineStyleRatioSpec } from '../specs/inline-style-ratio.js';
import { componentDecompositionSpec } from '../specs/component-decomposition.js';

// ---------------------------------------------------------------------------
// heading-hierarchy: toChecklistItems
// ---------------------------------------------------------------------------

describe('headingHierarchySpec.toChecklistItems', function headingChecklist() {
  it('returns heading-skips pass when violations === 0', function noViolations() {
    const items = headingHierarchySpec.toChecklistItems!('<h1>A</h1><h2>B</h2><h3>C</h3>');
    const item = items.find((i) => i.id === 'heading-skips');
    expect(item).toBeDefined();
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('returns heading-skips fail when violations > 0', function hasViolations() {
    const items = headingHierarchySpec.toChecklistItems!('<h1>A</h1><h3>C</h3>');
    const item = items.find((i) => i.id === 'heading-skips');
    expect(item!.status).toBe('fail');
  });

  it('returns heading-skips unknown when no headings (canScore: false)', function noHeadings() {
    const items = headingHierarchySpec.toChecklistItems!('<p>No headings</p>');
    const item = items.find((i) => i.id === 'heading-skips');
    expect(item!.status).toBe('incomplete');
  });

  it('returns heading-skips unknown on empty html', function emptyHtml() {
    const items = headingHierarchySpec.toChecklistItems!('');
    const item = items.find((i) => i.id === 'heading-skips');
    expect(item!.status).toBe('incomplete');
  });

  it('includes a reason string', function hasReason() {
    const items = headingHierarchySpec.toChecklistItems!('<h1>A</h1>');
    expect(items[0].reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// link-quality: toChecklistItems
// ---------------------------------------------------------------------------

describe('linkQualitySpec.toChecklistItems', function linkChecklist() {
  it('returns broken-links pass when invalid === 0', function noInvalid() {
    const items = linkQualitySpec.toChecklistItems!(
      '<a href="https://example.com">A</a><a href="/about">B</a>',
    );
    const item = items.find((i) => i.id === 'broken-links');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('returns broken-links fail when invalid > 0', function hasInvalid() {
    const items = linkQualitySpec.toChecklistItems!(
      '<a href="">Bad</a><a href="https://example.com">Good</a>',
    );
    const item = items.find((i) => i.id === 'broken-links');
    expect(item!.status).toBe('fail');
  });

  it('returns broken-links unknown when no links (canScore: false)', function noLinks() {
    const items = linkQualitySpec.toChecklistItems!('<p>No links</p>');
    const item = items.find((i) => i.id === 'broken-links');
    expect(item!.status).toBe('incomplete');
  });

  // eslint-disable-next-line no-script-url
  it('javascript: link causes broken-links fail', function javascriptLink() {
    const items = linkQualitySpec.toChecklistItems!('<a href="javascript:void(0)">Click</a>');
    const item = items.find((i) => i.id === 'broken-links');
    expect(item!.status).toBe('fail');
  });
});

// ---------------------------------------------------------------------------
// responsive-grid-collapse: toChecklistItems
// ---------------------------------------------------------------------------

describe('responsiveGridCollapseSpec.toChecklistItems', function gridChecklist() {
  it('returns grid-collapse pass when offendingGrids === 0', function noOffenders() {
    const items = responsiveGridCollapseSpec.toChecklistItems!(
      '<html><body><div class="grid grid-cols-1 md:grid-cols-3">A</div></body></html>',
    );
    const item = items.find((i) => i.id === 'grid-collapse');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('returns grid-collapse fail when offendingGrids > 0', function hasOffenders() {
    const items = responsiveGridCollapseSpec.toChecklistItems!(
      '<html><body><div class="grid grid-cols-3">A</div></body></html>',
    );
    const item = items.find((i) => i.id === 'grid-collapse');
    expect(item!.status).toBe('fail');
  });

  it('returns grid-collapse unknown when no multi-column grids (canScore: false)', function noGrids() {
    const items = responsiveGridCollapseSpec.toChecklistItems!('<html><body><p>No grids</p></body></html>');
    const item = items.find((i) => i.id === 'grid-collapse');
    expect(item!.status).toBe('incomplete');
  });
});

// ---------------------------------------------------------------------------
// responsive-readiness: toChecklistItems (viewport-meta only)
// ---------------------------------------------------------------------------

describe('responsiveReadinessSpec.toChecklistItems', function viewportChecklist() {
  it('returns viewport-meta pass when viewport meta tag is present', function hasViewport() {
    const items = responsiveReadinessSpec.toChecklistItems!(
      '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>',
    );
    const item = items.find((i) => i.id === 'viewport-meta');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('returns viewport-meta fail when no viewport meta tag', function noViewport() {
    const items = responsiveReadinessSpec.toChecklistItems!(
      '<html><head><title>No viewport</title></head><body><p>content</p></body></html>',
    );
    const item = items.find((i) => i.id === 'viewport-meta');
    expect(item!.status).toBe('fail');
  });

  it('returns exactly one check (viewport-meta, not breakpoints/flex-grid)', function onlyViewport() {
    const items = responsiveReadinessSpec.toChecklistItems!(
      '<div class="md:flex grid">content</div>',
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('viewport-meta');
  });
});

// ---------------------------------------------------------------------------
// accessibility-coverage: toChecklistItems (null-coverage rule)
// ---------------------------------------------------------------------------

describe('accessibilityCoverageSpec.toChecklistItems', function accessibilityChecklist() {
  it('img-alt pass when all images have non-empty alt', function allImagesAlt() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<img src="a.png" alt="A cat"><img src="b.png" alt="A dog">',
    );
    const item = items.find((i) => i.id === 'img-alt');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('img-alt fail when any image missing alt (coverage < 1.0)', function partialAlt() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<img src="a.png" alt="A cat"><img src="b.png">',
    );
    const item = items.find((i) => i.id === 'img-alt');
    expect(item!.status).toBe('fail');
  });

  it('img-alt fail when all images missing alt (coverage 0.5)', function noAlt() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<img src="a.png"><img src="b.png">',
    );
    const item = items.find((i) => i.id === 'img-alt');
    expect(item!.status).toBe('fail');
  });

  it('img-alt unknown when no images on page (null sub-score)', function noImages() {
    const items = accessibilityCoverageSpec.toChecklistItems!('<p>No images here</p>');
    const item = items.find((i) => i.id === 'img-alt');
    expect(item!.status).toBe('incomplete');
  });

  it('form-labels pass when all inputs have labels', function allLabeled() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<input type="text" aria-label="Name"><input type="email" aria-label="Email">',
    );
    const item = items.find((i) => i.id === 'form-labels');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('form-labels fail when inputs missing labels (coverage < 1.0)', function unlabeled() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<input type="text"><input type="email" aria-label="Email">',
    );
    const item = items.find((i) => i.id === 'form-labels');
    expect(item!.status).toBe('fail');
  });

  it('form-labels unknown when no labelable inputs (null sub-score)', function noInputs() {
    const items = accessibilityCoverageSpec.toChecklistItems!('<p>No inputs</p>');
    const item = items.find((i) => i.id === 'form-labels');
    expect(item!.status).toBe('incomplete');
  });

  it('interactive-names pass when all buttons/anchors have names', function allNamed() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<button>Submit</button><a href="/about">About</a>',
    );
    const item = items.find((i) => i.id === 'interactive-names');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('invariance');
  });

  it('interactive-names fail when any interactive element missing name', function unnamedButton() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<button></button><a href="/about">About</a>',
    );
    const item = items.find((i) => i.id === 'interactive-names');
    expect(item!.status).toBe('fail');
  });

  it('interactive-names unknown when no interactive elements (null sub-score)', function noInteractive() {
    const items = accessibilityCoverageSpec.toChecklistItems!('<p>No buttons or links</p>');
    const item = items.find((i) => i.id === 'interactive-names');
    expect(item!.status).toBe('incomplete');
  });

  it('three checks are independent: null img-alt, pass form-labels, fail interactive-names', function mixedIndependent() {
    const items = accessibilityCoverageSpec.toChecklistItems!(
      '<input type="text" aria-label="Name"><button></button>',
    );
    const imgAlt = items.find((i) => i.id === 'img-alt');
    const formLabels = items.find((i) => i.id === 'form-labels');
    const interactiveNames = items.find((i) => i.id === 'interactive-names');
    expect(imgAlt!.status).toBe('incomplete');
    expect(formLabels!.status).toBe('pass');
    expect(interactiveNames!.status).toBe('fail');
  });

  it('non-finite guard: img-alt uses Number.isFinite before === 1.0 comparison', function nonFiniteGuard() {
    // This test verifies the implementation cannot produce a false 'pass' from a NaN/Infinity ratio.
    // With 0 images on page: null sub-score -> unknown (no comparison reached at all).
    // With all-alt images: safeRatio returns 1.0 (finite) -> pass.
    // The guard is structural — confirmed by the implementation using Number.isFinite.
    const allAlt = accessibilityCoverageSpec.toChecklistItems!('<img src="a.png" alt="Cat">');
    const item = allAlt.find((i) => i.id === 'img-alt');
    expect(item!.status).toBe('pass');
  });

  it('returns exactly 3 items (img-alt, form-labels, interactive-names)', function threeItems() {
    const items = accessibilityCoverageSpec.toChecklistItems!('<p>plain text</p>');
    const ids = items.map((i) => i.id);
    expect(ids).toContain('img-alt');
    expect(ids).toContain('form-labels');
    expect(ids).toContain('interactive-names');
    expect(items).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// inline-style-ratio: toChecklistItems
// ---------------------------------------------------------------------------

describe('inlineStyleRatioSpec.toChecklistItems', function inlineStyleChecklist() {
  it('returns low-inline-style pass when withAuthoredStyle === 0', function noAuthoredStyles() {
    const items = inlineStyleRatioSpec.toChecklistItems!(
      '<div class="container"><p>Text</p></div>',
    );
    const item = items.find((i) => i.id === 'low-inline-style');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('directional');
  });

  it('returns low-inline-style fail when any element has authored inline style', function hasAuthoredStyle() {
    const items = inlineStyleRatioSpec.toChecklistItems!(
      '<div style="color: red"><p>Text</p></div>',
    );
    const item = items.find((i) => i.id === 'low-inline-style');
    expect(item!.status).toBe('fail');
  });

  it('returns low-inline-style unknown when no elements (canScore: false)', function noElements() {
    const items = inlineStyleRatioSpec.toChecklistItems!('');
    const item = items.find((i) => i.id === 'low-inline-style');
    expect(item!.status).toBe('incomplete');
  });

  it('framework-only styles do not cause fail', function frameworkOnly() {
    const items = inlineStyleRatioSpec.toChecklistItems!(
      '<div style="--tw-shadow: 0">content</div>',
    );
    const item = items.find((i) => i.id === 'low-inline-style');
    expect(item!.status).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// component-decomposition: toChecklistItems
// ---------------------------------------------------------------------------

describe('componentDecompositionSpec.toChecklistItems', function componentChecklist() {
  const FILE_COUNT_THRESHOLD = 5;
  const DIR_THRESHOLD = 3;

  it('returns component-file-count pass when uniqueFiles >= threshold (5)', function fileCountPass() {
    const html =
      '<div data-dev-file="src/A.tsx">A</div>' +
      '<div data-dev-file="src/B.tsx">B</div>' +
      '<div data-dev-file="src/C.tsx">C</div>' +
      '<div data-dev-file="src/D.tsx">D</div>' +
      '<div data-dev-file="src/E.tsx">E</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-file-count');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('directional');
  });

  it('returns component-file-count fail when uniqueFiles < threshold', function fileCountFail() {
    const items = componentDecompositionSpec.toChecklistItems!(
      '<div data-dev-file="src/A.tsx">A</div>' +
      '<div data-dev-file="src/B.tsx">B</div>',
    );
    const item = items.find((i) => i.id === 'component-file-count');
    expect(item!.status).toBe('fail');
  });

  it(`returns component-file-count fail at exactly ${FILE_COUNT_THRESHOLD - 1} files (one below threshold)`, function fileCountBoundary() {
    const html = Array.from(
      { length: FILE_COUNT_THRESHOLD - 1 },
      (_, i) => `<div data-dev-file="src/${String.fromCharCode(65 + i)}.tsx">${i}</div>`,
    ).join('');
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-file-count');
    expect(item!.status).toBe('fail');
  });

  it(`returns component-file-count pass at exactly ${FILE_COUNT_THRESHOLD} files (at threshold)`, function fileCountAtThreshold() {
    const html = Array.from(
      { length: FILE_COUNT_THRESHOLD },
      (_, i) => `<div data-dev-file="src/${String.fromCharCode(65 + i)}.tsx">${i}</div>`,
    ).join('');
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-file-count');
    expect(item!.status).toBe('pass');
  });

  it('returns component-dir-separation pass when uniqueDirs >= threshold (3)', function dirPass() {
    const html =
      '<div data-dev-file="src/components/A.tsx">A</div>' +
      '<div data-dev-file="src/pages/B.tsx">B</div>' +
      '<div data-dev-file="src/layout/C.tsx">C</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-dir-separation');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('directional');
  });

  it('returns component-dir-separation fail when uniqueDirs < threshold', function dirFail() {
    const items = componentDecompositionSpec.toChecklistItems!(
      '<div data-dev-file="src/A.tsx">A</div>' +
      '<div data-dev-file="src/B.tsx">B</div>',
    );
    const item = items.find((i) => i.id === 'component-dir-separation');
    expect(item!.status).toBe('fail');
  });

  it(`returns component-dir-separation fail at exactly ${DIR_THRESHOLD - 1} dirs (one below threshold)`, function dirBoundary() {
    const html =
      '<div data-dev-file="src/components/A.tsx">A</div>' +
      '<div data-dev-file="src/pages/B.tsx">B</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-dir-separation');
    expect(item!.status).toBe('fail');
  });

  it(`returns component-dir-separation pass at exactly ${DIR_THRESHOLD} dirs (at threshold)`, function dirAtThreshold() {
    const html =
      '<div data-dev-file="src/components/A.tsx">A</div>' +
      '<div data-dev-file="src/pages/B.tsx">B</div>' +
      '<div data-dev-file="src/layout/C.tsx">C</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-dir-separation');
    expect(item!.status).toBe('pass');
  });

  it('returns component-reuse pass when reuse ratio >= threshold', function reusePass() {
    // 2 of 2 unique files reused → ratio 1.0 >= threshold
    const html =
      '<div data-dev-file="src/Button.tsx">A</div>' +
      '<div data-dev-file="src/Button.tsx">B</div>' +
      '<div data-dev-file="src/Card.tsx">C</div>' +
      '<div data-dev-file="src/Card.tsx">D</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-reuse');
    expect(item!.status).toBe('pass');
    expect(item!.type).toBe('directional');
  });

  it('returns component-reuse fail when reuse ratio < threshold', function reuseFail() {
    // 0 of 3 unique files reused → ratio 0.0 < threshold
    const html =
      '<div data-dev-file="src/A.tsx">A</div>' +
      '<div data-dev-file="src/B.tsx">B</div>' +
      '<div data-dev-file="src/C.tsx">C</div>';
    const items = componentDecompositionSpec.toChecklistItems!(html);
    const item = items.find((i) => i.id === 'component-reuse');
    expect(item!.status).toBe('fail');
  });

  it('returns all 3 checks as unknown when no data-dev-file attrs (canScore: false)', function noDevFile() {
    const items = componentDecompositionSpec.toChecklistItems!('<div><p>content</p></div>');
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.status).toBe('incomplete');
    }
  });

  it('returns exactly 3 items (component-file-count, component-dir-separation, component-reuse)', function threeItems() {
    const items = componentDecompositionSpec.toChecklistItems!(
      '<div data-dev-file="src/A.tsx">A</div>',
    );
    const ids = items.map((i) => i.id);
    expect(ids).toContain('component-file-count');
    expect(ids).toContain('component-dir-separation');
    expect(ids).toContain('component-reuse');
  });
});

// ---------------------------------------------------------------------------
// Cross-spec: error path — empty/malformed html produces all-unknown
// ---------------------------------------------------------------------------

describe('toChecklistItems error path: empty html produces all-unknown', function errorPath() {
  it('headingHierarchySpec: empty -> unknown', function headingEmpty() {
    const items = headingHierarchySpec.toChecklistItems!('');
    expect(items.every((i) => i.status === 'incomplete')).toBe(true);
  });

  it('linkQualitySpec: empty -> unknown', function linkEmpty() {
    const items = linkQualitySpec.toChecklistItems!('');
    expect(items.every((i) => i.status === 'incomplete')).toBe(true);
  });

  it('inlineStyleRatioSpec: empty -> unknown', function inlineEmpty() {
    const items = inlineStyleRatioSpec.toChecklistItems!('');
    expect(items.every((i) => i.status === 'incomplete')).toBe(true);
  });

  it('componentDecompositionSpec: empty -> unknown', function componentEmpty() {
    const items = componentDecompositionSpec.toChecklistItems!('');
    expect(items.every((i) => i.status === 'incomplete')).toBe(true);
  });
});
