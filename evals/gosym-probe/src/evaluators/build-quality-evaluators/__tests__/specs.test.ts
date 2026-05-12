import { describe, expect, it } from 'vitest';

import { headingHierarchySpec } from '../specs/heading-hierarchy.js';
import { semanticDensitySpec } from '../specs/semantic-density.js';
import { accessibilityCoverageSpec } from '../specs/accessibility-coverage.js';
import { linkQualitySpec } from '../specs/link-quality.js';
import { responsiveReadinessSpec } from '../specs/responsive-readiness.js';
import { inlineStyleRatioSpec } from '../specs/inline-style-ratio.js';
import { componentDecompositionSpec } from '../specs/component-decomposition.js';
import { safeRatio } from '../dom-eval-types.js';

// ---------------------------------------------------------------------------
// heading-hierarchy
// ---------------------------------------------------------------------------

describe('headingHierarchySpec', function headingHierarchy() {
  it('canScore: false when no headings present', function noHeadings() {
    const result = headingHierarchySpec.score('<p>No headings here</p>');
    expect(result.canScore).toBe(false);
    expect(result.details).toMatchObject({ totalHeadings: 0 });
  });

  it('score 1.0 for a single h1', function singleH1() {
    const result = headingHierarchySpec.score('<h1>Title</h1>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.details).toMatchObject({ totalHeadings: 1, violations: 0 });
  });

  it('score 1.0 for correct h1→h2→h3 sequence', function sequential() {
    const result = headingHierarchySpec.score(
      '<h1>A</h1><h2>B</h2><h3>C</h3>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.details).toMatchObject({ violations: 0 });
  });

  it('violation when h1 jumps to h3', function jumpH1toH3() {
    // totalHeadings=2, violations=1 → score = 1 - 1/2 = 0.5
    const result = headingHierarchySpec.score('<h1>A</h1><h3>C</h3>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBeCloseTo(0.5, 5);
    expect(result.details).toMatchObject({ violations: 1 });
  });

  it('going up (h3→h2) does not count as a violation', function goingUp() {
    const result = headingHierarchySpec.score('<h3>C</h3><h2>B</h2>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.details).toMatchObject({ violations: 0 });
  });

  it('multiple h1 elements do not count as violations', function multipleH1() {
    const result = headingHierarchySpec.score('<h1>A</h1><h1>B</h1>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.details).toMatchObject({ violations: 0 });
  });

  it('h1→h6 single large jump counts as one violation', function bigJump() {
    const result = headingHierarchySpec.score('<h1>A</h1><h6>B</h6>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBeCloseTo(0.5, 5);
    expect(result.details).toMatchObject({ violations: 1 });
  });

  it('details includes sequence array', function sequenceDetails() {
    const result = headingHierarchySpec.score('<h1>A</h1><h2>B</h2>');
    expect(result.details).toMatchObject({ sequence: [1, 2] });
  });
});

// ---------------------------------------------------------------------------
// semantic-density
// ---------------------------------------------------------------------------

describe('semanticDensitySpec', function semanticDensity() {
  it('canScore: false on empty body', function empty() {
    const result = semanticDensitySpec.score('');
    expect(result.canScore).toBe(false);
  });

  it('canScore: false when no block-level elements', function noElements() {
    const result = semanticDensitySpec.score('<span>text only</span>');
    expect(result.canScore).toBe(false);
  });

  it('score 0 when only non-empty divs', function allDivs() {
    const result = semanticDensitySpec.score(
      '<div><p>A</p></div><div><p>B</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('score 1.0 when only semantic elements', function allSemantic() {
    const result = semanticDensitySpec.score(
      '<main><section>A</section></main><nav>B</nav><footer>C</footer>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('mixed content produces score between 0 and 1', function mixed() {
    const result = semanticDensitySpec.score(
      '<main><p>Content</p></main><div><p>Wrapper</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('all semantic tags score: nav, main, section, article, header, footer, aside, figure', function allTags() {
    const result = semanticDensitySpec.score(
      '<nav></nav><main></main><section></section><article></article>' +
      '<header></header><footer></footer><aside></aside><figure></figure>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// accessibility-coverage
// ---------------------------------------------------------------------------

describe('accessibilityCoverageSpec', function accessibilityCoverage() {
  it('canScore: false when no scoreable elements', function noElements() {
    const result = accessibilityCoverageSpec.score('<p>Plain text</p>');
    expect(result.canScore).toBe(false);
  });

  it('score 1.0 when all images have non-empty alt', function allImagesAlt() {
    const result = accessibilityCoverageSpec.score(
      '<img src="a.png" alt="A cat"><img src="b.png" alt="A dog">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 0 when all images are missing alt', function noAlt() {
    const result = accessibilityCoverageSpec.score(
      '<img src="a.png"><img src="b.png">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('empty alt="" counts as missing', function emptyAlt() {
    const result = accessibilityCoverageSpec.score('<img src="a.png" alt="">');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('score 1.0 when all inputs have aria-label', function allInputsLabeled() {
    const result = accessibilityCoverageSpec.score(
      '<input type="text" aria-label="Name"><input type="email" aria-label="Email">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 0 when inputs have no label at all', function noLabel() {
    const result = accessibilityCoverageSpec.score(
      '<input type="text"><input type="email">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('partial coverage produces intermediate score', function partial() {
    // 1 of 2 images has alt → image sub-score 0.5
    const result = accessibilityCoverageSpec.score(
      '<img src="a.png" alt="Cat"><img src="b.png">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('skips sub-dimensions with zero denominator', function skipEmpty() {
    // Only images present, no forms or interactive — should still produce a score
    const result = accessibilityCoverageSpec.score(
      '<img src="a.png" alt="Cat">',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  // Validation boundary: id attribute values containing regex metacharacters
  // must not cause SyntaxError in RegExp constructor and must still match labels correctly.

  it('formLabelCoverage: id with "[" metacharacter does not throw and matches label', function idWithBracket() {
    const html =
      '<label for="field[0]">Name</label>' +
      '<input type="text" id="field[0]">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('formLabelCoverage: id with "(" metacharacter does not throw and matches label', function idWithParen() {
    const html =
      '<label for="field(name)">Name</label>' +
      '<input type="text" id="field(name)">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('formLabelCoverage: id with "." metacharacter does not throw and matches label', function idWithDot() {
    const html =
      '<label for="user.email">Email</label>' +
      '<input type="email" id="user.email">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('formLabelCoverage: id with "+" metacharacter does not throw and matches label', function idWithPlus() {
    const html =
      '<label for="field+extra">Field</label>' +
      '<input type="text" id="field+extra">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('formLabelCoverage: id with "$" metacharacter does not throw and matches label', function idWithDollar() {
    const html =
      '<label for="price$usd">Price</label>' +
      '<input type="text" id="price$usd">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('formLabelCoverage: id with metacharacters returns score 0 when label is absent', function idWithMetaNoLabel() {
    const html = '<input type="text" id="field[0]">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  // Non-labelable input types excluded from denominator

  it('hidden input excluded from denominator (canScore: false when only input)', function hiddenOnly() {
    const result = accessibilityCoverageSpec.score('<input type="hidden" name="csrf">');
    // hidden is the only input, so form sub-dimension has no labelable inputs
    expect(result.canScore).toBe(false);
  });

  it('submit input without aria-label does not deflate score', function submitNoLabel() {
    const html = '<input type="submit" value="Go">';
    // submit excluded from denominator, so form sub-dimension canScore: false
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(false);
  });

  it('hidden excluded, text input with aria-label scores 1.0', function hiddenPlusLabeledText() {
    const html = '<input type="hidden"><input type="text" aria-label="Name">';
    const result = accessibilityCoverageSpec.score(html);
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  // interactiveAccessibleNames sub-dimension

  it('button with no text and no aria-label scores 0', function buttonNoName() {
    const result = accessibilityCoverageSpec.score('<button></button>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('button with aria-label scores 1.0', function buttonAriaLabel() {
    const result = accessibilityCoverageSpec.score('<button aria-label="Submit form"></button>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('anchor with text content scores 1.0', function anchorWithText() {
    const result = accessibilityCoverageSpec.score('<a href="/about">About us</a>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('mixed: one labeled button and one unlabeled button produces intermediate score', function mixedInteractive() {
    const result = accessibilityCoverageSpec.score(
      '<button aria-label="Close">X</button><button></button>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// link-quality
// ---------------------------------------------------------------------------

describe('linkQualitySpec', function linkQuality() {
  it('canScore: false when no links', function noLinks() {
    const result = linkQualitySpec.score('<p>No links here</p>');
    expect(result.canScore).toBe(false);
  });

  it('score 1.0 when all links are valid http(s)', function allValid() {
    const result = linkQualitySpec.score(
      '<a href="https://example.com">A</a><a href="http://foo.com">B</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 1.0 when all links are relative paths', function relativeLinks() {
    const result = linkQualitySpec.score(
      '<a href="/about">About</a><a href="/contact">Contact</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 1.0 when all links are anchors (#)', function allAnchors() {
    const result = linkQualitySpec.score(
      '<a href="#section1">S1</a><a href="#section2">S2</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 0 when all links have empty href', function emptyHref() {
    const result = linkQualitySpec.score(
      '<a href="">A</a><a href="  ">B</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('mixed valid and invalid links produce intermediate score', function mixed() {
    // 1 valid, 1 invalid
    const result = linkQualitySpec.score(
      '<a href="https://example.com">Good</a><a href="">Bad</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('links without href attribute count as invalid', function noHref() {
    const result = linkQualitySpec.score('<a>No href</a>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  // eslint-disable-next-line no-script-url
  it('javascript: URIs count as invalid', function javascriptUri() {
    const result = linkQualitySpec.score(
      '<a href="javascript:void(0)">Click</a><a href="https://example.com">Good</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeCloseTo(0.5, 5);
    expect(result.details).toMatchObject({ invalid: 1, valid: 1 });
  });

  // eslint-disable-next-line no-script-url
  it('JavaScript: URIs (mixed case) count as invalid', function javascriptMixedCase() {
    const result = linkQualitySpec.score('<a href="JavaScript:alert(1)">XSS</a>');
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('mailto: and tel: links count as valid', function mailtoTel() {
    const result = linkQualitySpec.score(
      '<a href="mailto:test@example.com">Email</a><a href="tel:+1234567890">Call</a>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// responsive-readiness
// ---------------------------------------------------------------------------

describe('responsiveReadinessSpec', function responsiveReadiness() {
  it('always canScore: true', function alwaysCanScore() {
    const result = responsiveReadinessSpec.score('');
    expect(result.canScore).toBe(true);
  });

  it('score 0 when none of the signals are present', function noSignals() {
    const result = responsiveReadinessSpec.score('<div>plain content</div>');
    expect(result.score).toBe(0);
  });

  it('adds 0.3 for viewport meta tag', function viewportMeta() {
    const result = responsiveReadinessSpec.score(
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
    );
    expect(result.score).toBeCloseTo(0.3, 5);
  });

  it('adds 0.4 for responsive class patterns (md:, lg:, sm:)', function responsiveClasses() {
    // Use md:block/lg:hidden to avoid triggering the flex/grid signal
    const result = responsiveReadinessSpec.score(
      '<div class="md:block lg:hidden sm:text-sm">content</div>',
    );
    expect(result.score).toBeCloseTo(0.4, 5);
  });

  it('adds 0.3 for flex or grid classes', function flexGrid() {
    const result = responsiveReadinessSpec.score(
      '<div class="flex items-center">content</div>',
    );
    expect(result.score).toBeCloseTo(0.3, 5);
  });

  it('score 1.0 when all three signals present', function allSignals() {
    const result = responsiveReadinessSpec.score(
      '<meta name="viewport" content="width=device-width">' +
      '<div class="md:flex grid lg:hidden">content</div>',
    );
    expect(result.score).toBeCloseTo(1.0, 5);
  });

  it('score 0.7 for viewport + responsive classes', function viewportPlusResponsive() {
    const result = responsiveReadinessSpec.score(
      '<meta name="viewport" content="width=device-width">' +
      '<div class="md:block lg:hidden">content</div>',
    );
    expect(result.score).toBeCloseTo(0.7, 5);
  });

  it('text content containing "flexible grid" does NOT trigger layout signal', function textContentFalsePositive() {
    // The word "flexible" and "grid" appear only in text content, not in a class attribute.
    // The spec must not award the flex/grid point for this.
    const result = responsiveReadinessSpec.score(
      '<p>We use a flexible grid layout for our design system.</p>',
    );
    expect(result.details).toMatchObject({ hasFlexGrid: false });
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// inline-style-ratio
// ---------------------------------------------------------------------------

describe('inlineStyleRatioSpec', function inlineStyleRatio() {
  it('canScore: false when no elements', function noElements() {
    const result = inlineStyleRatioSpec.score('');
    expect(result.canScore).toBe(false);
  });

  it('score 1.0 when no elements have inline styles', function noStyles() {
    const result = inlineStyleRatioSpec.score(
      '<div class="container"><p>Text</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('score 0 when all elements have authored inline styles', function allStyles() {
    const result = inlineStyleRatioSpec.score(
      '<div style="color: red"><p style="font-size: 14px">Text</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(0);
  });

  it('framework-only styles (--tw-*) are not counted as authored', function frameworkStyles() {
    const result = inlineStyleRatioSpec.score(
      '<div style="--tw-ring-color: rgba(59,130,246,.5); --tw-shadow: 0 0 0">content</div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('var(--font-*) framework styles are not counted as authored', function fontVarStyles() {
    const result = inlineStyleRatioSpec.score(
      '<p style="font-family: var(--font-sans)">text</p>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('mixed authored and framework styles count as authored', function mixedStyles() {
    // This element has both --tw-* AND authored color: red — counts as authored
    const result = inlineStyleRatioSpec.score(
      '<div style="--tw-shadow: 0; color: red"><p>text</p></div>',
    );
    expect(result.canScore).toBe(true);
    // 1 element with authored style out of 2 total → 1 without = safeRatio(1, 2) = 0.5
    expect(result.score).toBeCloseTo(0.5, 5);
  });

  it('partial coverage produces intermediate score', function partial() {
    const result = inlineStyleRatioSpec.score(
      '<div style="color: red"><p>no style</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// component-decomposition
// ---------------------------------------------------------------------------

describe('componentDecompositionSpec', function componentDecomposition() {
  it('canScore: false when no data-dev-file attributes', function noDevFile() {
    const result = componentDecompositionSpec.score('<div><p>content</p></div>');
    expect(result.canScore).toBe(false);
  });

  it('single file → low score', function singleFile() {
    const result = componentDecompositionSpec.score(
      '<div data-dev-file="src/App.tsx"><p>content</p></div>',
    );
    expect(result.canScore).toBe(true);
    expect(result.score).toBeLessThan(0.5);
  });

  it('multiple files in same directory → partial score', function sameDir() {
    const result = componentDecompositionSpec.score(
      '<div data-dev-file="src/Header.tsx">A</div>' +
      '<div data-dev-file="src/Footer.tsx">B</div>' +
      '<div data-dev-file="src/Nav.tsx">C</div>',
    );
    expect(result.canScore).toBe(true);
    // fileCount contributes but dirSeparation is low (1 dir)
    expect(result.score).toBeGreaterThan(0);
  });

  it('multiple files in multiple directories → higher score', function multipleDirs() {
    const singleDir = componentDecompositionSpec.score(
      '<div data-dev-file="src/A.tsx">A</div>' +
      '<div data-dev-file="src/B.tsx">B</div>' +
      '<div data-dev-file="src/C.tsx">C</div>',
    );
    const multiDir = componentDecompositionSpec.score(
      '<div data-dev-file="src/components/A.tsx">A</div>' +
      '<div data-dev-file="src/components/B.tsx">B</div>' +
      '<div data-dev-file="src/pages/Home.tsx">C</div>',
    );
    expect(multiDir.score).toBeGreaterThan(singleDir.score);
  });

  it('reused components (same file appears multiple times) boosts score', function reuseBoost() {
    // Both cases have the same 2 unique files — only reuse differs
    const withReuse = componentDecompositionSpec.score(
      '<div data-dev-file="src/Button.tsx">A</div>' +
      '<div data-dev-file="src/Button.tsx">B</div>' +
      '<div data-dev-file="src/Header.tsx">C</div>',
    );
    // Button and Header each appear once — no reuse
    const withoutReuse = componentDecompositionSpec.score(
      '<div data-dev-file="src/Button.tsx">A</div>' +
      '<div data-dev-file="src/Header.tsx">B</div>',
    );
    expect(withReuse.score).toBeGreaterThan(withoutReuse.score);
  });

  it('details include file count and directory count', function details() {
    const result = componentDecompositionSpec.score(
      '<div data-dev-file="src/components/A.tsx">A</div>' +
      '<div data-dev-file="src/pages/B.tsx">B</div>',
    );
    expect(result.details).toMatchObject({
      uniqueFiles: 2,
      uniqueDirs: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// safeRatio
// ---------------------------------------------------------------------------

describe('safeRatio', function safeRatioTests() {
  it('safeRatio(0, 0) returns 1.0 (denominator zero guard)', function zeroZero() {
    expect(safeRatio(0, 0)).toBe(1.0);
  });

  it('safeRatio(1, 0) returns 1.0 (denominator zero guard)', function oneZero() {
    expect(safeRatio(1, 0)).toBe(1.0);
  });

  it('safeRatio(3, 6) returns 0.5 (normal division)', function normalDivision() {
    expect(safeRatio(3, 6)).toBeCloseTo(0.5, 5);
  });

  it('safeRatio(6, 6) returns 1.0 (full coverage)', function fullCoverage() {
    expect(safeRatio(6, 6)).toBe(1.0);
  });

  it('safeRatio(0, 5) returns 0 (zero numerator)', function zeroNumerator() {
    expect(safeRatio(0, 5)).toBe(0);
  });

  it('safeRatio(10, 5) returns 1.0 (clamped to 1 when result exceeds 1)', function clampAboveOne() {
    expect(safeRatio(10, 5)).toBe(1.0);
  });

  it('safeRatio(1, Infinity) returns 1.0 (non-finite denominator guard)', function infiniteDenominator() {
    expect(safeRatio(1, Infinity)).toBe(1.0);
  });

  it('safeRatio(1, NaN) returns 1.0 (non-finite denominator guard)', function nanDenominator() {
    expect(safeRatio(1, NaN)).toBe(1.0);
  });
});
