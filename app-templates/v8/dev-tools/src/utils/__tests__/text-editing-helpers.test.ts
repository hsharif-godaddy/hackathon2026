/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findEditableContainer,
  findBrSegment,
  unwrapAiroSpans,
  unwrapAiroSegments,
  unwrapOrReveal,
  safeSetInnerHtml,
  wrapBareChildTextNodes,
  normalizeHtml,
  formattingSignature,
  showIndicator,
  injectEditorCss,
  mergeOriginalClasses,
  mergeRootAttrsOntoOverlay,
  extractThemeColors,
  ensureBoldFontLoaded,
  INLINE_TAGS,
  watchTextReflected,
} from "../text-editing-helpers";

vi.mock("../translations", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

function html(markup: string): HTMLElement {
  const doc = new DOMParser().parseFromString("<div>" + markup + "</div>", "text/html");
  const source = doc.body.querySelector("div")!;
  const div = document.createElement("div");
  while (source.firstChild) div.appendChild(document.adoptNode(source.firstChild));
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

// ── findEditableContainer ──

describe("findEditableContainer", () => {
  it("returns a text element when clicked directly", () => {
    const root = html('<p>Hello</p>');
    const p = root.querySelector("p")!;
    expect(findEditableContainer(p, true)).toBe(p);
  });

  it("walks up through inline tags to find container", () => {
    const root = html('<p><strong>Bold</strong></p>');
    const strong = root.querySelector("strong")!;
    expect(findEditableContainer(strong, true)?.tagName).toBe("P");
  });

  it("returns null for non-text elements", () => {
    const root = html('<div><img /></div>');
    const img = root.querySelector("img")!;
    expect(findEditableContainer(img as HTMLElement, true)).toBeNull();
  });

  it("rejects elements containing <br>", () => {
    const root = html('<h1>Hello<br /><span>World</span></h1>');
    const h1 = root.querySelector("h1")!;
    expect(findEditableContainer(h1, true)).toBeNull();
  });

  it("lifts from <li> to parent <ul> when parent is editable", () => {
    const root = html('<ul class="list-disc pl-6"><li>Item text</li></ul>');
    const li = root.querySelector("li")!;
    const ul = root.querySelector("ul")!;
    expect(findEditableContainer(li, true)).toBe(ul);
  });

  it("lifts from <li> to parent <ol> when parent is editable", () => {
    const root = html('<ol class="list-decimal pl-6"><li>Item text</li></ol>');
    const li = root.querySelector("li")!;
    const ol = root.querySelector("ol")!;
    expect(findEditableContainer(li, true)).toBe(ol);
  });

  it("returns <ul> directly when clicked", () => {
    const root = html('<ul class="list-disc"><li>Item</li></ul>');
    const ul = root.querySelector("ul")!;
    expect(findEditableContainer(ul, true)).toBe(ul);
  });

  it("returns null when walking past a non-inline tag", () => {
    const root = html('<div><p>Text</p></div>');
    const div = root.querySelector("div")!;
    expect(findEditableContainer(div, true)).toBeNull();
  });

  it("returns null for content-keyed span inside text-editable p when flag is off (regression)", () => {
    // The bug: with flag OFF, isTextEditable(span, false) → false (content key),
    // loop advances to <p> (no content key) → isTextEditable(p, false) → true,
    // returns <p> and opens JSX editor, corrupting the CMS binding.
    // The fix: return null immediately when a content-keyed element is encountered.
    const root = html('<p>Label <span data-dev-content-key=\'{"key":"hero.label","kind":"copy"}\'>value</span></p>');
    const span = root.querySelector("span")!;
    expect(findEditableContainer(span as HTMLElement, false)).toBeNull();
  });

  it("does not return null for content-keyed span when flag is on", () => {
    // Flag ON: the content-keyed element should be editable via the CMS path.
    const root = html('<p>Label <span data-dev-content-key=\'{"key":"hero.label","kind":"copy"}\'>value</span></p>');
    const span = root.querySelector("span")!;
    const result = findEditableContainer(span as HTMLElement, true);
    expect(result).not.toBeNull();
    // Must not return the wrapping <p> — the content-keyed span itself (or its
    // inline container) is the correct edit target, not the parent block element.
    const p = root.querySelector("p")!;
    expect(result).not.toBe(p);
  });
});

// ── findBrSegment ──

describe("findBrSegment", () => {
  it("returns existing inline child as segment", () => {
    const root = html('<h1>Hello<br /><span class="x">World</span></h1>');
    const span = root.querySelector("span")!;
    const h1 = root.querySelector("h1")!;
    const result = findBrSegment(span, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.segment).toBe(span);
    expect(result!.parent).toBe(h1);
  });

  it("walks up nested inline to find direct child segment", () => {
    const root = html('<h1>Text<br /><span><strong>Bold</strong></span></h1>');
    const strong = root.querySelector("strong")!;
    const span = root.querySelector("span")!;
    const result = findBrSegment(strong, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.segment).toBe(span);
  });

  it("returns null when no br-containing ancestor exists", () => {
    const root = html('<p>No breaks here</p>');
    const p = root.querySelector("p")!;
    expect(findBrSegment(p, 0, 0, true)).toBeNull();
  });

  it("returns null for a <br> element itself", () => {
    const root = html('<h1>Hello<br /><span>World</span></h1>');
    const br = root.querySelector("br")!;
    expect(findBrSegment(br as HTMLElement, 0, 0, true)).toBeNull();
  });

  it("heals to first bare segment when caret resolution fails (br-parent click)", () => {
    // Behavior change: previously this returned null when the caret could not
    // resolve to a glyph (common on large/centered display headings). The
    // self-healing fallback now wraps the first non-empty direct-child text
    // node instead. In this markup "Hello" is a bare text node, so clicking the
    // <h1> with a failed caret heals to "Hello" rather than refusing the cursor.
    const root = html('<h1>Hello<br /><span>World</span></h1>');
    const h1 = root.querySelector("h1")!;
    document.caretRangeFromPoint = vi.fn(() => null);
    const result = findBrSegment(h1, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(h1);
    expect(result!.segment.textContent).toBe("Hello");
    expect(result!.segment.getAttribute("data-airo-wrapped")).toBe("true");
  });

  it("heals to first bare line on a bare-text <br> heading when caret is null", () => {
    const root = html('<h1>Shop better.<br />Spend less.</h1>');
    const h1 = root.querySelector("h1")!;
    document.caretRangeFromPoint = vi.fn(() => null);
    const result = findBrSegment(h1, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(h1);
    expect(result!.segment.textContent).toBe("Shop better.");
    expect(result!.segment.getAttribute("data-airo-wrapped")).toBe("true");
  });

  it("wraps the precise bare text node the caret resolves to (precise click)", () => {
    const root = html('<h1>Shop better.<br />Spend less.</h1>');
    const h1 = root.querySelector("h1")!;
    const secondLine: Node = Array.from(h1.childNodes).find(
      (n: ChildNode): boolean => n.nodeType === Node.TEXT_NODE && n.textContent === "Spend less.",
    )!;
    document.caretRangeFromPoint = vi.fn((): Range => {
      const range: Range = document.createRange();
      range.setStart(secondLine, 0);
      return range;
    });
    const result = findBrSegment(h1, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(h1);
    expect(result!.segment.textContent).toBe("Spend less.");
    expect(result!.segment.getAttribute("data-airo-wrapped")).toBe("true");
  });

  it("returns null when the br-parent has no non-empty bare text node", () => {
    const root = html('<h1>   <br /><span>World</span></h1>');
    const h1 = root.querySelector("h1")!;
    document.caretRangeFromPoint = vi.fn(() => null);
    expect(findBrSegment(h1, 0, 0, true)).toBeNull();
  });

  it("wraps multi-element segment before first <br>", () => {
    const root = html('<h1><span>Find </span><strong>stillness.</strong><br /><span>Rest.</span></h1>');
    const strong = root.querySelector("strong")!;
    const h1 = root.querySelector("h1")!;
    const result = findBrSegment(strong, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.parent).toBe(h1);
    expect(result!.segment.getAttribute("data-airo-segment")).toBe("true");
    expect(result!.segment.textContent).toBe("Find stillness.");
  });

  it("wraps multi-element segment after last <br>", () => {
    const root = html('<h1><span>Hello</span><br /><span>Find </span><strong>stillness.</strong></h1>');
    const strong = root.querySelector("strong")!;
    const result = findBrSegment(strong, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.segment.getAttribute("data-airo-segment")).toBe("true");
    expect(result!.segment.textContent).toBe("Find stillness.");
  });

  it("wraps multi-element segment between <br>s", () => {
    const root = html('<h1><span>Hello</span><br /><span>Find </span><strong>stillness.</strong><br /><span>Rest.</span></h1>');
    const span = root.querySelectorAll("span")[1]; // "Find "
    const result = findBrSegment(span, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.segment.getAttribute("data-airo-segment")).toBe("true");
    expect(result!.segment.textContent).toBe("Find stillness.");
  });

  it("does not wrap single-element segment", () => {
    const root = html('<h1>Hello<br /><span>World</span></h1>');
    const span = root.querySelector("span")!;
    const result = findBrSegment(span, 0, 0, true);
    expect(result).not.toBeNull();
    expect(result!.segment).toBe(span);
    expect(result!.segment.hasAttribute("data-airo-segment")).toBe(false);
  });

  it("returns null for a content-keyed inline element with a <br> when flag is off (guard regression)", () => {
    // An inline content-keyed element containing a <br> would otherwise walk past
    // to its parent; only the flag-off hard-stop stops it from opening the JSX
    // editor there and corrupting the binding. isTextEditable's own `!isInline`
    // check doesn't cover this case — the element is inline.
    const root = html('<span data-dev-content-key=\'{"key":"hero.label","kind":"copy"}\'>A<br />B</span>');
    const span = root.querySelector("span")!;
    expect(findBrSegment(span, 0, 0, false)).toBeNull();
  });
});

// ── unwrapAiroSpans ──

describe("unwrapAiroSpans", () => {
  it("unwraps spans with data-airo-wrapped", () => {
    const root = html('<p><span data-airo-wrapped="true">Hello</span> World</p>');
    const p = root.querySelector("p")!;
    unwrapAiroSpans(p);
    expect(p.querySelector("[data-airo-wrapped]")).toBeNull();
    expect(p.textContent).toBe("Hello World");
  });

  it("handles multiple wrapped spans", () => {
    const root = html(
      '<div><span data-airo-wrapped="true">A</span><span data-airo-wrapped="true">B</span></div>'
    );
    const div = root.querySelector("div")!;
    unwrapAiroSpans(div);
    expect(div.querySelectorAll("[data-airo-wrapped]")).toHaveLength(0);
    expect(div.textContent).toBe("AB");
  });

  it("does nothing when no wrapped spans exist", () => {
    const root = html('<p><strong>Bold</strong></p>');
    const p = root.querySelector("p")!;
    const before = p.innerHTML;
    unwrapAiroSpans(p);
    expect(p.innerHTML).toBe(before);
  });
});

// ── wrapBareChildTextNodes ──

describe("wrapBareChildTextNodes", () => {
  it("wraps bare text nodes in <span>", () => {
    const root = html('<h1>THE ROLLING<br /><span>FEAST</span></h1>');
    const h1 = root.querySelector("h1")!;
    wrapBareChildTextNodes(h1);
    const spans = h1.querySelectorAll("span");
    expect(spans.length).toBe(2);
    expect(spans[0].textContent).toBe("THE ROLLING");
    expect(spans[1].textContent).toBe("FEAST");
  });

  it("does not wrap whitespace-only text nodes", () => {
    const root = html('<p>   <strong>Bold</strong></p>');
    const p = root.querySelector("p")!;
    const childCountBefore = p.childNodes.length;
    wrapBareChildTextNodes(p);
    // Whitespace-only node should not be wrapped
    expect(p.querySelectorAll("span")).toHaveLength(0);
    expect(p.childNodes.length).toBe(childCountBefore);
  });

  it("does not double-wrap existing elements", () => {
    const root = html('<p><span>Already wrapped</span></p>');
    const p = root.querySelector("p")!;
    wrapBareChildTextNodes(p);
    expect(p.querySelectorAll("span")).toHaveLength(1);
  });

  it("wraps multiple bare text siblings independently", () => {
    const root = html('<div></div>');
    const div = root.querySelector("div")!;
    div.appendChild(document.createTextNode("A"));
    div.appendChild(document.createElement("br"));
    div.appendChild(document.createTextNode("B"));
    wrapBareChildTextNodes(div);
    const spans = div.querySelectorAll("span");
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe("A");
    expect(spans[1].textContent).toBe("B");
  });
});

// ── normalizeHtml ──

describe("normalizeHtml", () => {
  it("strips data-dev-file and data-dev-line attributes", () => {
    const result = normalizeHtml(
      '<span data-dev-file="/app/index.tsx" data-dev-line="10">Text</span>'
    );
    expect(result).not.toContain("data-dev-file");
    expect(result).not.toContain("data-dev-line");
    expect(result).toContain("Text");
  });

  it("collapses redundant same-tag nesting", () => {
    const result = normalizeHtml("<strong><strong>Bold</strong></strong>");
    expect(result).toBe("<strong>Bold</strong>");
  });

  it("does not collapse nesting when outer has attributes", () => {
    const result = normalizeHtml(
      '<span class="x"><span>Inner</span></span>'
    );
    expect(result).toContain('class="x"');
    expect(result).toContain("Inner");
  });

  it("preserves mixed content", () => {
    const result = normalizeHtml(
      '<strong>Hello</strong> <em>World</em>'
    );
    expect(result).toContain("<strong>Hello</strong>");
    expect(result).toContain("<em>World</em>");
  });

  it("handles deeply nested redundant tags", () => {
    const result = normalizeHtml("<em><em><em>Deep</em></em></em>");
    expect(result).toBe("<em>Deep</em>");
  });

  it("merges adjacent unstyled spans", () => {
    const result = normalizeHtml(
      '<span data-dev-file="/app/index.tsx" data-dev-line="54">Find</span>' +
      '<span data-dev-file="/app/index.tsx" data-dev-line="54"> stillness.</span>'
    );
    expect(result).toBe("<span>Find stillness.</span>");
  });

  it("merges adjacent same-tag elements with identical attributes", () => {
    const result = normalizeHtml(
      '<strong>Find </strong><strong>stillness.</strong>'
    );
    expect(result).toBe("<strong>Find stillness.</strong>");
  });

  it("does not merge elements with different tags", () => {
    const result = normalizeHtml(
      '<strong>Bold</strong><em>Italic</em>'
    );
    expect(result).toContain("<strong>Bold</strong>");
    expect(result).toContain("<em>Italic</em>");
  });

  it("does not merge elements with different styles", () => {
    const result = normalizeHtml(
      '<span style="color: red">Red</span><span style="color: blue">Blue</span>'
    );
    expect(result).toContain("Red");
    expect(result).toContain("Blue");
    expect(result).toMatch(/<span[^>]*>Red<\/span>/);
    expect(result).toMatch(/<span[^>]*>Blue<\/span>/);
  });

  it("merges three adjacent same-styled spans", () => {
    const result = normalizeHtml(
      '<span>A</span><span>B</span><span>C</span>'
    );
    expect(result).toBe("<span>ABC</span>");
  });

  it("preserves text nodes between merged elements", () => {
    const result = normalizeHtml(
      '<span>Hello</span> <span>World</span>'
    );
    expect(result).toBe("<span>Hello</span> <span>World</span>");
  });

  it("merges adjacent bold elements", () => {
    const result = normalizeHtml(
      '<strong>Find </strong><strong>stillness.</strong>'
    );
    expect(result).toBe("<strong>Find stillness.</strong>");
  });

  it("merges adjacent italic elements", () => {
    const result = normalizeHtml(
      '<em>Find </em><em>stillness.</em>'
    );
    expect(result).toBe("<em>Find stillness.</em>");
  });

  it("merges adjacent bold-italic (nested) elements", () => {
    const result = normalizeHtml(
      '<strong><em>Find </em></strong><strong><em>stillness.</em></strong>'
    );
    expect(result).toBe("<strong><em>Find stillness.</em></strong>");
  });

  it("does not merge bold + unstyled spans", () => {
    const result = normalizeHtml(
      '<strong>Find </strong><span>stillness.</span>'
    );
    expect(result).toContain("<strong>Find </strong>");
    expect(result).toContain("<span>stillness.</span>");
  });

  it("does not merge bold + italic elements", () => {
    const result = normalizeHtml(
      '<strong>Find </strong><em>stillness.</em>'
    );
    expect(result).toContain("<strong>Find </strong>");
    expect(result).toContain("<em>stillness.</em>");
  });

  it("canonicalizes em>strong to strong>em before merging", () => {
    const result = normalizeHtml(
      '<strong><em>Find </em></strong><em><strong>stillness.</strong></em>'
    );
    expect(result).toBe("<strong><em>Find stillness.</em></strong>");
  });

  it("canonicalizes i>b to b>i (semantic: em>strong to strong>em)", () => {
    const result = normalizeHtml('<i><b>text</b></i>');
    expect(result).toBe("<strong><em>text</em></strong>");
  });

  it("does not canonicalize when outer element has attributes", () => {
    const result = normalizeHtml('<em class="x"><strong>text</strong></em>');
    expect(result).toContain('class="x"');
    expect(result).toContain("<strong>text</strong>");
  });

  it("strips empty style/class attrs before merging", () => {
    const result = normalizeHtml(
      '<span>Find</span><span style=""> stillness.</span>'
    );
    expect(result).toBe("<span>Find stillness.</span>");
  });

  it("merges adjacent styled spans with same inline style", () => {
    const result = normalizeHtml(
      '<span style="font-weight: bold">Find </span><span style="font-weight: bold">stillness.</span>'
    );
    expect(result).toBe('<span style="font-weight: bold">Find stillness.</span>');
  });
});

// ── formattingSignature ──

describe("formattingSignature", () => {
  it("treats <i><em>X</em></i> same as <em>X</em> (Lexical double-wraps italic)", () => {
    expect(formattingSignature('<i><em>Today</em></i>')).toBe(
      formattingSignature('<em>Today</em>')
    );
  });

  it("treats <b><strong>X</strong></b> same as <strong>X</strong>", () => {
    expect(formattingSignature('<b><strong>Bold</strong></b>')).toBe(
      formattingSignature('<strong>Bold</strong>')
    );
  });

  it("ignores bare <span> wrappers (Lexical wraps plain text in <span>)", () => {
    expect(formattingSignature('<em>A</em><span>! </span><em>B</em>')).toBe(
      formattingSignature('<em>A</em><em>B</em>')
    );
  });

  it("ignores bare <span> at start", () => {
    expect(formattingSignature('<span>Hello </span><em>world</em>')).toBe(
      formattingSignature('<em>world</em>')
    );
  });

  it("does NOT ignore <span> with style attribute (styled spans are meaningful)", () => {
    expect(formattingSignature('<span style="color:red">A</span>')).not.toBe(
      formattingSignature('A')
    );
  });

  it("does NOT ignore <span> with class attribute", () => {
    expect(formattingSignature('<span class="highlight">A</span>')).not.toBe(
      formattingSignature('A')
    );
  });

  it("ignores <span> with only data-* attributes (Lexical artifact)", () => {
    expect(formattingSignature('<span data-lexical-text="true">A</span>')).toBe(
      formattingSignature('A')
    );
  });

  it("detects real formatting differences", () => {
    expect(formattingSignature('<strong>A</strong>')).not.toBe(
      formattingSignature('<em>A</em>')
    );
  });

  it("detects added formatting", () => {
    expect(formattingSignature('<em>A</em> B')).not.toBe(
      formattingSignature('<em>A</em> <em>B</em>')
    );
  });

  it("handles the exact Lexical output from the bug report", () => {
    const initial = '<em>Today</em>! <em>Beautiful</em>';
    const lexicalOutput = '<i><em>Today</em></i><span>! </span><em>Beautiful</em>';
    expect(formattingSignature(lexicalOutput)).toBe(
      formattingSignature(initial)
    );
  });
});

// ── showIndicator ──

describe("showIndicator", () => {
  it("creates a success indicator element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 100, right: 200, bottom: 120, left: 50, width: 150, height: 20, x: 50, y: 100, toJSON: () => {} });

    showIndicator(el, "success");
    const indicator = document.getElementById("edit-mode-save-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toBe("Saved");
  });

  it("creates an error indicator element", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 100, right: 200, bottom: 120, left: 50, width: 150, height: 20, x: 50, y: 100, toJSON: () => {} });

    showIndicator(el, "error");
    const indicator = document.getElementById("edit-mode-save-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toBe("Edit failed");
  });

  it("uses a custom error indicator message", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 100, right: 200, bottom: 120, left: 50, width: 150, height: 20, x: 50, y: 100, toJSON: () => {} });

    showIndicator(el, "error", "This text is generated by code");
    const indicator = document.getElementById("edit-mode-save-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toBe("This text is generated by code");
  });

  it("removes existing indicator before creating new one", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} });

    showIndicator(el, "success");
    showIndicator(el, "error");
    const indicators = document.querySelectorAll("#edit-mode-save-indicator");
    expect(indicators).toHaveLength(1);
    expect(indicators[0].textContent).toBe("Edit failed");
  });

  it("creates a saving indicator with a spinner and persists (no auto-dismiss)", () => {
    vi.useFakeTimers();
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 100, right: 200, bottom: 120, left: 50, width: 150, height: 20, x: 50, y: 100, toJSON: () => {} });

    showIndicator(el, "saving");
    const indicator = document.getElementById("edit-mode-save-indicator");
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain("Saving");
    expect(indicator!.querySelector(".airo-edit-spinner")).not.toBeNull();

    // Terminal indicators auto-dismiss; "saving" must stay until replaced.
    vi.advanceTimersByTime(10_000);
    expect(document.getElementById("edit-mode-save-indicator")).not.toBeNull();
    vi.useRealTimers();
  });

  it("a success indicator replaces the saving spinner", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.getBoundingClientRect = () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} });

    showIndicator(el, "saving");
    showIndicator(el, "success");
    const indicators = document.querySelectorAll("#edit-mode-save-indicator");
    expect(indicators).toHaveLength(1);
    expect(indicators[0].textContent).toBe("Saved");
    expect(indicators[0].querySelector(".airo-edit-spinner")).toBeNull();
  });
});

// ── injectEditorCss ──

describe("injectEditorCss", () => {
  it("injects a <style> element with editor classes", () => {
    injectEditorCss();
    const styles = Array.from(document.querySelectorAll("style"));
    const editorStyle = styles.find((s) => s.textContent?.includes("airo-rte-p"));
    expect(editorStyle).toBeDefined();
    expect(editorStyle!.textContent).toContain("airo-rte-italic");
  });

  it("includes list styles with visible markers", () => {
    injectEditorCss();
    const styles = Array.from(document.querySelectorAll("style"));
    const editorStyle = styles.find((s) => s.textContent?.includes("airo-rte-p"));
    expect(editorStyle).toBeDefined();
    expect(editorStyle!.textContent).toContain("airo-rte-ul");
    expect(editorStyle!.textContent).toContain("list-style");
    expect(editorStyle!.textContent).toContain("airo-rte-ol");
    expect(editorStyle!.textContent).toContain("airo-rte-li");
  });
});

// ── mergeOriginalClasses ──

describe("mergeOriginalClasses", () => {
  it("merges original classes onto a new root tag", () => {
    const result = mergeOriginalClasses(
      '<ul class="list-disc pl-6"><li>text</li></ul>',
      "text-lg text-white/80 mb-8 leading-relaxed",
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const ul = doc.body.firstElementChild!;
    expect(ul.classList.contains("list-disc")).toBe(true);
    expect(ul.classList.contains("text-lg")).toBe(true);
    expect(ul.classList.contains("text-white/80")).toBe(true);
    expect(ul.classList.contains("mb-8")).toBe(true);
    expect(ul.classList.contains("leading-relaxed")).toBe(true);
  });

  it("does not duplicate classes already present on the new root", () => {
    const result = mergeOriginalClasses(
      '<ul class="list-disc pl-6"><li>text</li></ul>',
      "list-disc text-lg",
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const ul = doc.body.firstElementChild!;
    const classes = ul.getAttribute("class")!.split(/\s+/);
    expect(classes.filter((c) => c === "list-disc")).toHaveLength(1);
    expect(classes).toContain("text-lg");
    expect(classes).toContain("pl-6");
  });

  it("returns unchanged HTML when no original classes exist", () => {
    const input = '<ul class="list-disc pl-6"><li>text</li></ul>';
    expect(mergeOriginalClasses(input, "")).toBe(input);
    expect(mergeOriginalClasses(input, null as unknown as string)).toBe(input);
  });

  it("adds class attribute when new root has none", () => {
    const result = mergeOriginalClasses(
      "<ul><li>text</li></ul>",
      "text-lg mb-4",
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const ul = doc.body.firstElementChild!;
    expect(ul.classList.contains("text-lg")).toBe(true);
    expect(ul.classList.contains("mb-4")).toBe(true);
  });

  it("strips list-only classes when merging onto a non-list element", () => {
    const result = mergeOriginalClasses(
      "<p>text</p>",
      "list-disc pl-6 text-lg text-white/80 mb-8",
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const p = doc.body.firstElementChild!;
    expect(p.classList.contains("text-lg")).toBe(true);
    expect(p.classList.contains("text-white/80")).toBe(true);
    expect(p.classList.contains("mb-8")).toBe(true);
    expect(p.classList.contains("list-disc")).toBe(false);
    expect(p.classList.contains("pl-6")).toBe(false);
  });

  it("keeps list classes when merging onto a list element", () => {
    const result = mergeOriginalClasses(
      '<ul class="list-disc"><li>text</li></ul>',
      "list-disc pl-6 text-lg",
    );
    const doc = new DOMParser().parseFromString(result, "text/html");
    const ul = doc.body.firstElementChild!;
    expect(ul.classList.contains("list-disc")).toBe(true);
    expect(ul.classList.contains("pl-6")).toBe(true);
    expect(ul.classList.contains("text-lg")).toBe(true);
  });
});

// ── safeSetInnerHtml ──

describe("safeSetInnerHtml", () => {
  it("replaces element children with parsed HTML", () => {
    const el = document.createElement("div");
    el.textContent = "old";
    safeSetInnerHtml(el, "<strong>new</strong> content");
    expect(el.innerHTML).toBe("<strong>new</strong> content");
  });

  it("clears existing children before inserting", () => {
    const el = document.createElement("div");
    el.innerHTML = "<p>one</p><p>two</p>";
    safeSetInnerHtml(el, "<span>replaced</span>");
    expect(el.children.length).toBe(1);
    expect(el.textContent).toBe("replaced");
  });

  it("handles empty HTML string", () => {
    const el = document.createElement("div");
    el.textContent = "content";
    safeSetInnerHtml(el, "");
    expect(el.innerHTML).toBe("");
  });
});

// ── unwrapAiroSegments ──

describe("unwrapAiroSegments", () => {
  it("unwraps spans with data-airo-segment", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-airo-segment="true">hello</span> world';
    unwrapAiroSegments(root);
    expect(root.innerHTML).toBe("hello world");
  });

  it("handles nested segment spans", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-airo-segment="true"><strong>bold</strong> text</span>';
    unwrapAiroSegments(root);
    expect(root.innerHTML).toBe("<strong>bold</strong> text");
  });

  it("does nothing when no segments exist", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>normal</span>";
    unwrapAiroSegments(root);
    expect(root.innerHTML).toBe("<span>normal</span>");
  });
});

// ── unwrapOrReveal ──

describe("unwrapOrReveal", () => {
  it("unwraps data-airo-wrapped element and restores parent visibility", () => {
    const parent = document.createElement("div");
    parent.style.visibility = "hidden";
    const wrapped = document.createElement("span");
    wrapped.setAttribute("data-airo-wrapped", "true");
    wrapped.textContent = "text";
    parent.appendChild(wrapped);
    unwrapOrReveal(wrapped);
    expect(parent.textContent).toBe("text");
    expect(parent.querySelector("[data-airo-wrapped]")).toBeNull();
    expect(parent.style.visibility).toBe("");
  });

  it("unwraps data-airo-segment element", () => {
    const parent = document.createElement("div");
    const segment = document.createElement("span");
    segment.setAttribute("data-airo-segment", "true");
    segment.innerHTML = "<em>italic</em>";
    parent.appendChild(segment);
    unwrapOrReveal(segment);
    expect(parent.innerHTML).toBe("<em>italic</em>");
  });

  it("reveals non-wrapped elements by clearing visibility", () => {
    const el = document.createElement("p");
    el.style.visibility = "hidden";
    el.textContent = "visible";
    document.body.appendChild(el);
    unwrapOrReveal(el);
    expect(el.style.visibility).toBe("");
  });
});

// ── mergeRootAttrsOntoOverlay ──

describe("mergeRootAttrsOntoOverlay", () => {
  it("merges style properties from source onto target", () => {
    const target = document.createElement("div");
    target.style.position = "absolute";
    const source = document.createElement("div");
    source.setAttribute("style", "color: red; font-size: 16px;");
    mergeRootAttrsOntoOverlay(target, source);
    expect(target.style.color).toBe("red");
    expect(target.style.fontSize).toBe("16px");
    expect(target.style.position).toBe("absolute");
  });

  it("merges class names without duplicating", () => {
    const target = document.createElement("div");
    target.setAttribute("class", "existing");
    const source = document.createElement("div");
    source.setAttribute("class", "new-class");
    mergeRootAttrsOntoOverlay(target, source);
    expect(target.getAttribute("class")).toBe("existing new-class");
  });

  it("handles source with no style or class", () => {
    const target = document.createElement("div");
    target.style.top = "10px";
    const source = document.createElement("div");
    mergeRootAttrsOntoOverlay(target, source);
    expect(target.style.top).toBe("10px");
  });
});

// ── extractThemeColors ──

describe("extractThemeColors", () => {
  it("pads with fallback palette to always return maxColors entries", () => {
    // No content elements → page palette is empty, so the result is purely fallbacks.
    const result = extractThemeColors();
    expect(result.length).toBe(6);
  });

  it("returns hex colors derived from getComputedStyle", () => {
    html('<p style="color: rgb(255, 0, 0)">Hello</p>');
    const result = extractThemeColors();
    expect(result).toContain("#ff0000");
  });

  it("dedupes and ranks by frequency (text colors first)", () => {
    html(
      '<p style="color: rgb(255, 0, 0)">A</p>' +
      '<p style="color: rgb(255, 0, 0)">B</p>' +
      '<p style="color: rgb(0, 0, 255)">C</p>'
    );
    const result = extractThemeColors();
    expect(result[0]).toBe("#ff0000");
    expect(result).toContain("#0000ff");
  });

  it("respects the maxColors cap", () => {
    html(
      '<p style="color: rgb(255, 0, 0)">A</p>' +
      '<p style="color: rgb(0, 255, 0)">B</p>' +
      '<p style="color: rgb(0, 0, 255)">C</p>'
    );
    expect(extractThemeColors(2).length).toBe(2);
  });

  it("skips elements inside dev-tools UI (data-dev-tools)", () => {
    html('<div data-dev-tools="true"><span style="color: rgb(123, 45, 67)">DevTool</span></div>');
    expect(extractThemeColors()).not.toContain("#7b2d43");
  });

  it("skips elements inside dev-tools UI (data-airo-dev-tools)", () => {
    // The HoverBar tree uses the airo-prefixed marker. extractThemeColors must
    // skip it so HoverBar button colors don't pollute the theme palette.
    html('<div data-airo-dev-tools=""><button style="background-color: rgb(45, 67, 89)"></button></div>');
    expect(extractThemeColors()).not.toContain("#2d4359");
  });

  it("skips text-element entries with empty trimmed text", () => {
    // Pure-empty text elements don't contribute their text color.
    html('<p style="color: rgb(11, 22, 33)">   </p>');
    // The paragraph still has a default white background so it'll show up via
    // background scanning in jsdom, but the color #0b1621 (text) must not.
    expect(extractThemeColors()).not.toContain("#0b1621");
  });

  it("includes background colors from non-text elements", () => {
    html('<section style="background-color: rgb(11, 22, 33)"></section>');
    expect(extractThemeColors()).toContain("#0b1621");
  });
});

// ── INLINE_TAGS ──

describe("INLINE_TAGS", () => {
  it("contains expected inline formatting tags", () => {
    for (const tag of ["em", "strong", "b", "i", "span", "br", "a"]) {
      expect(INLINE_TAGS.has(tag)).toBe(true);
    }
  });

  it("does not contain block-level tags", () => {
    for (const tag of ["div", "p", "h1", "section"]) {
      expect(INLINE_TAGS.has(tag)).toBe(false);
    }
  });
});

// ── ensureBoldFontLoaded ──

describe("ensureBoldFontLoaded", () => {
  let fontsLoadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    fontsLoadMock = vi.fn().mockResolvedValue([]);
    (document as any).fonts = { load: fontsLoadMock };
  });

  function makeElement(fontFamily: string): HTMLElement {
    const el = document.createElement("div");
    el.style.fontFamily = fontFamily;
    document.body.appendChild(el);
    return el;
  }

  // Each test uses a unique font name so the module-level dedupe cache stays
  // clean across runs without exposing a private reset helper.
  const uniqueName = () => `TestFont${Math.random().toString(36).slice(2)}`;

  it("requests both regular (400) and bold (700) weights from Google Fonts", () => {
    const name = uniqueName();
    ensureBoldFontLoaded(makeElement(`"${name}"`));
    const link = document.head.querySelector('link[rel="stylesheet"]') as HTMLLinkElement;
    expect(link).not.toBeNull();
    expect(link.href).toContain(name);
    expect(link.href).toContain("wght@400;700");
  });

  it("loads both 400 and 700 via document.fonts.load on stylesheet load", () => {
    const name = uniqueName();
    ensureBoldFontLoaded(makeElement(`"${name}"`));
    const link = document.head.querySelector('link[rel="stylesheet"]') as HTMLLinkElement;
    link.onload?.(new Event("load"));
    expect(fontsLoadMock).toHaveBeenCalledWith(`400 1em "${name}"`);
    expect(fontsLoadMock).toHaveBeenCalledWith(`700 1em "${name}"`);
  });

  it("does not inject a link for system fonts", () => {
    ensureBoldFontLoaded(makeElement("Arial, sans-serif"));
    expect(document.head.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it("does not double-load after a successful load", () => {
    const name = uniqueName();
    const el = makeElement(`"${name}"`);
    ensureBoldFontLoaded(el);
    const link = document.head.querySelector('link[rel="stylesheet"]') as HTMLLinkElement;
    link.onload?.(new Event("load"));
    ensureBoldFontLoaded(el);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(1);
  });

  it("retries after a failed stylesheet load (does not poison cache)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const name = uniqueName();
    const el = makeElement(`"${name}"`);
    ensureBoldFontLoaded(el);
    const firstLink = document.head.querySelector('link[rel="stylesheet"]') as HTMLLinkElement;
    firstLink.onerror?.(new Event("error"));
    // Second call after failure should inject another link
    ensureBoldFontLoaded(el);
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(2);
    warnSpy.mockRestore();
  });
});

// ── watchTextReflected ──

describe("watchTextReflected", () => {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it("fires synchronously when the source already shows the expected text", () => {
    const el = html("<span>$8.50</span>").querySelector("span") as HTMLElement;
    const onReflected = vi.fn();
    watchTextReflected(el, "$8.50", onReflected);
    expect(onReflected).toHaveBeenCalledTimes(1);
  });

  it("fires once when a later mutation brings the source into agreement", async () => {
    const el = html("<span>$4.00</span>").querySelector("span") as HTMLElement;
    const onReflected = vi.fn();
    watchTextReflected(el, "$8.50", onReflected);
    expect(onReflected).not.toHaveBeenCalled();

    el.textContent = "$8.50"; // simulate the HMR re-render landing
    await tick();
    expect(onReflected).toHaveBeenCalledTimes(1);
  });

  it("ignores mutations that do not match the expected text", async () => {
    const el = html("<span>$4.00</span>").querySelector("span") as HTMLElement;
    const onReflected = vi.fn();
    watchTextReflected(el, "$8.50", onReflected);

    el.textContent = "$7.00";
    await tick();
    expect(onReflected).not.toHaveBeenCalled();
  });

  it("stops watching after the returned disconnect is called", async () => {
    const el = html("<span>$4.00</span>").querySelector("span") as HTMLElement;
    const onReflected = vi.fn();
    const disconnect = watchTextReflected(el, "$8.50", onReflected);

    disconnect();
    el.textContent = "$8.50";
    await tick();
    expect(onReflected).not.toHaveBeenCalled();
  });

  it("trims whitespace when comparing", () => {
    const el = html("<span>  $8.50  </span>").querySelector("span") as HTMLElement;
    const onReflected = vi.fn();
    watchTextReflected(el, "$8.50", onReflected);
    expect(onReflected).toHaveBeenCalledTimes(1);
  });
});
