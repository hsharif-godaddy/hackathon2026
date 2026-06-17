import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { collectMediaSlotDomMatches, findMediaSlotDomIndex } from "../media-slot-dom";

describe("media-slot-dom", function packageTests() {
  let container: HTMLDivElement;

  beforeEach(function setup() {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(function teardown() {
    container.remove();
  });

  describe("#findMediaSlotDomIndex", function findMediaSlotDomIndexTests() {
    it("returns index among cards when img wrapper is always first child", function cardGrid() {
      const slotPath = "pages/trucks/featured";
      const url = `/airo-assets/images/${slotPath}`;

      for (let i = 0; i < 3; i++) {
        const card = document.createElement("div");
        const wrapper = document.createElement("div");
        const img = document.createElement("img");
        img.src = url;
        wrapper.appendChild(img);
        card.appendChild(wrapper);
        container.appendChild(card);
      }

      const clicked = container.children[2]?.querySelector("img") as HTMLImageElement;
      expect(findMediaSlotDomIndex(clicked, slotPath)).toBe(2);
      expect(collectMediaSlotDomMatches(slotPath)).toHaveLength(3);
    });

    it("returns null when element is not part of the slot", function unrelated() {
      const img = document.createElement("img");
      img.src = "/airo-assets/images/pages/other/hero";
      container.appendChild(img);
      expect(findMediaSlotDomIndex(img, "pages/trucks/featured")).toBeNull();
    });
  });
});
