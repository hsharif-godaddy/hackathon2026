// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildContentUpdatePayload } from "../content-edit-payload";

function el(attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement("span");
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

describe("buildContentUpdatePayload", () => {
  const target = { key: "home.stats[0].value", kind: "copy" as const };

  it("includes expectedCurrent (the original text) for a derived node", () => {
    const payload = buildContentUpdatePayload(
      el({ "data-dev-content-derived": "true" }),
      target,
      "124,000+",
      "200,000+",
    );
    expect(payload.expectedCurrent).toBe("124,000+");
    // guard engages against the text the user started from, NOT the new text
    expect(payload.expectedCurrent).not.toBe("200,000+");
  });

  it("omits expectedCurrent entirely for a non-derived node", () => {
    const payload = buildContentUpdatePayload(el(), target, "Old", "New");
    expect("expectedCurrent" in payload).toBe(false);
  });

  it("treats a missing / non-'true' derived attribute as non-derived", () => {
    const payload = buildContentUpdatePayload(
      el({ "data-dev-content-derived": "false" }),
      target,
      "Old",
      "New",
    );
    expect("expectedCurrent" in payload).toBe(false);
  });

  it("propagates content key, kind, and old/new text", () => {
    const payload = buildContentUpdatePayload(
      el(),
      { key: "home.hero.title", kind: "richText" },
      "Old title",
      "New title",
    );
    expect(payload).toMatchObject({
      contentKey: "home.hero.title",
      kind: "richText",
      oldText: "Old title",
      newText: "New title",
    });
  });
});
