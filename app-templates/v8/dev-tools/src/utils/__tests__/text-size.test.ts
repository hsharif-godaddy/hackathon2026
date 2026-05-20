import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SIZE_SCALE,
  nextSize,
  nearestSizeClass,
} from "../text-size.ts";

describe("nextSize", () => {
  it("steps up through the normal range", () => {
    assert.equal(nextSize("text-base", "up"), "text-lg");
    assert.equal(nextSize("text-2xl", "up"), "text-3xl");
  });

  it("steps down through the normal range", () => {
    assert.equal(nextSize("text-lg", "down"), "text-base");
    assert.equal(nextSize("text-xs", "down"), null);
  });

  it("caps stepping up at text-6xl to keep layouts intact", () => {
    // text-7xl, text-8xl, text-9xl regularly overflow section heights and
    // push content out of containers. The stepper exposes text-xs..text-6xl
    // as its working range.
    assert.equal(nextSize("text-5xl", "up"), "text-6xl");
    assert.equal(nextSize("text-6xl", "up"), null);
  });

  it("uses the full scale (cap = text-9xl) on heading tags h1-h6", () => {
    // Headings frequently want big sizes; the default text-6xl cap was
    // locking users out of stepping their h1 back up after a couple − clicks.
    // Discriminate by tag: h1-h6 get the whole scale, body text keeps the
    // overflow-protection cap at text-6xl.
    assert.equal(nextSize("text-6xl", "up", { tagName: "h1" }), "text-7xl");
    assert.equal(nextSize("text-7xl", "up", { tagName: "h2" }), "text-8xl");
    assert.equal(nextSize("text-8xl", "up", { tagName: "h3" }), "text-9xl");
    assert.equal(nextSize("text-9xl", "up", { tagName: "h4" }), null); // top of scale
  });

  it("keeps the conservative cap on non-heading tags", () => {
    assert.equal(nextSize("text-6xl", "up", { tagName: "p" }), null);
    assert.equal(nextSize("text-6xl", "up", { tagName: "span" }), null);
    assert.equal(nextSize("text-6xl", "up", { tagName: "div" }), null);
  });

  it("still lets non-heading body text step up when it ALREADY starts oversized", () => {
    // Existing dynamic-shift behavior: if a paragraph somehow starts at
    // text-7xl+, allow stepping inside that range. Same as before.
    assert.equal(nextSize("text-7xl", "up", { tagName: "p" }), "text-8xl");
  });

  it("treats tag names case-insensitively (DOM tagName is uppercase)", () => {
    // selectedElement.tagName returns "H1", not "h1".
    assert.equal(nextSize("text-6xl", "up", { tagName: "H1" }), "text-7xl");
  });

  it("lets users keep stepping up when the element already starts oversized", () => {
    // Some headings legitimately ship at text-7xl+. The default cap (text-6xl)
    // exists to keep accidental layout overflow from happening on a normal
    // heading; it should not lock a user out of an element that was already
    // designed at that scale. When the current size is past the default cap,
    // the cap effectively shifts to the top of the scale.
    assert.equal(nextSize("text-7xl", "up"), "text-8xl");
    assert.equal(nextSize("text-8xl", "up"), "text-9xl");
    assert.equal(nextSize("text-9xl", "up"), null); // top of scale, no further
  });

  it("still allows stepping DOWN out of an oversized range", () => {
    // Counterpart: if an element is at text-9xl, − should bring it back
    // step-by-step. Otherwise the user is stuck.
    assert.equal(nextSize("text-9xl", "down"), "text-8xl");
    assert.equal(nextSize("text-7xl", "down"), "text-6xl");
  });
});

describe("nearestSizeClass", () => {
  // Bug repro: an element with `text-6xl md:text-8xl` renders at text-8xl
  // on desktop, but classList scanning preferred the base text-6xl. Stepping
  // down then jumped from what looked like text-8xl to text-5xl. Computed
  // font-size is the only reliable signal — it reflects what the user sees,
  // including responsive variants at the current breakpoint and theme
  // overrides.

  it("returns an exact-match scale class when font-size matches a default Tailwind size", () => {
    // Tailwind defaults at root 16px: text-6xl = 3.75rem = 60px, text-8xl = 6rem = 96px
    assert.equal(nearestSizeClass(60), "text-6xl");
    assert.equal(nearestSizeClass(96), "text-8xl");
    assert.equal(nearestSizeClass(16), "text-base");
  });

  it("rounds to the nearest scale class when font-size doesn't match exactly", () => {
    // Theme overrides or rem variations may produce off-scale sizes.
    // text-7xl = 4.5rem = 72px, text-8xl = 6rem = 96px → midpoint 84px
    assert.equal(nearestSizeClass(80), "text-7xl"); // closer to 72
    assert.equal(nearestSizeClass(90), "text-8xl"); // closer to 96
  });

  it("breaks ties at the exact midpoint by picking the smaller scale class", () => {
    // Midpoint 84px between text-7xl (72px) and text-8xl (96px). Tie-break
    // is order-of-iteration: SIZE_SCALE walks small→large, "<" not "<=",
    // so the first (smaller) match wins. Locks the contract so a future
    // refactor can't silently flip it.
    assert.equal(nearestSizeClass(84), "text-7xl");
  });

  it("clamps below the floor and above the cap", () => {
    assert.equal(nearestSizeClass(0), "text-xs");
    assert.equal(nearestSizeClass(1000), "text-9xl");
  });

  it("respects a custom root px when the document uses a non-default html font-size", () => {
    // Tailwind classes resolve to rem; if root is 20px (rare but possible),
    // text-base = 1rem = 20px. Caller passes the document root.
    assert.equal(nearestSizeClass(20, 20), "text-base");
    assert.equal(nearestSizeClass(75, 20), "text-6xl"); // 3.75rem * 20 = 75
  });
});

describe("SIZE_SCALE", () => {
  it("is ordered small → large and includes the full Tailwind range", () => {
    assert.equal(SIZE_SCALE[0], "text-xs");
    assert.equal(SIZE_SCALE[SIZE_SCALE.length - 1], "text-9xl");
    assert.ok(SIZE_SCALE.includes("text-base"));
    assert.ok(SIZE_SCALE.includes("text-5xl"));
  });
});
