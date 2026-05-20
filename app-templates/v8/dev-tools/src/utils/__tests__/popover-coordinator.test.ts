import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextOpenMenu } from "../popover-coordinator.ts";

describe("nextOpenMenu", () => {
  // Cole's Slack feedback (AIROBUILD-1745 review): Color Picker, Text Size
  // Stepper, and Text Align could all show up on top of each other. Only one
  // should be visible at a time. The reducer enforces that by treating an
  // "open" request as exclusive — the requested menu becomes the only one.

  it("opens a menu when none is open", () => {
    assert.equal(nextOpenMenu(null, "color", true), "color");
    assert.equal(nextOpenMenu(null, "size", true), "size");
    assert.equal(nextOpenMenu(null, "align", true), "align");
  });

  it("opening a different menu closes whatever is currently open", () => {
    // The whole point of the coordinator: switching menus is implicit, not
    // a two-step close-then-open dance. Without this, the previously open
    // child still renders its popover until its own outside-click handler
    // fires — and during that window both popovers stack visually.
    assert.equal(nextOpenMenu("color", "size", true), "size");
    assert.equal(nextOpenMenu("size", "align", true), "align");
    assert.equal(nextOpenMenu("align", "color", true), "color");
  });

  it("closes only when the closing menu matches the currently open one", () => {
    assert.equal(nextOpenMenu("color", "color", false), null);
    assert.equal(nextOpenMenu("size", "size", false), null);
  });

  it("ignores stale close requests from a no-longer-active menu", () => {
    // Defensive: a child component might emit `onOpenChange(false)` from an
    // outside-click handler shortly after the parent already switched to a
    // different menu. The reducer must not let that close drop the new one.
    assert.equal(nextOpenMenu("size", "color", false), "size");
    assert.equal(nextOpenMenu("align", "size", false), "align");
  });

  it("close-when-nothing-open is a no-op", () => {
    assert.equal(nextOpenMenu(null, "color", false), null);
    assert.equal(nextOpenMenu(null, "size", false), null);
  });
});
