/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  findMediaSlotElementInSlide,
  getCarouselSlideAtIndex,
  syncMediaPanelToCarouselSlide,
} from "../carousel-slot-panel-sync";
import { send } from "../eventBus";

vi.mock("../eventBus", () => ({
  send: vi.fn(),
}));

describe("carousel-slot-panel-sync", function carouselSlotPanelSyncTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
    delete (window as Window & { __airoCarouselSlotEditActive?: boolean }).__airoCarouselSlotEditActive;
    delete (window as Window & { __airoCarouselSlotEditRoot?: HTMLElement | null }).__airoCarouselSlotEditRoot;
  });

  afterEach(function teardown() {
    document.body.innerHTML = "";
  });

  describe("getCarouselSlideAtIndex", function getCarouselSlideAtIndexTests() {
    it("returns the slide at the requested index", function indexedSlide() {
      const carousel = document.createElement("div");
      carousel.setAttribute("aria-roledescription", "carousel");
      const slide0 = document.createElement("div");
      slide0.setAttribute("aria-roledescription", "slide");
      const slide1 = document.createElement("div");
      slide1.setAttribute("aria-roledescription", "slide");
      carousel.append(slide0, slide1);
      document.body.appendChild(carousel);

      expect(getCarouselSlideAtIndex(carousel, 1)).toBe(slide1);
    });
  });

  describe("findMediaSlotElementInSlide", function findMediaSlotElementInSlideTests() {
    it("finds an img bound to an airo media slot", function imgSlot() {
      const slide = document.createElement("div");
      const img = document.createElement("img");
      img.src = "/airo-assets/images/pages/home/hero-2?v=1";
      slide.appendChild(img);

      expect(findMediaSlotElementInSlide(slide)).toBe(img);
    });
  });

  describe("syncMediaPanelToCarouselSlide", function syncMediaPanelToCarouselSlideTests() {
    it("opens the media panel for the selected slide slot", function opensPanel() {
      const carousel = document.createElement("div");
      carousel.setAttribute("aria-roledescription", "carousel");

      const slide0 = document.createElement("div");
      slide0.setAttribute("aria-roledescription", "slide");
      const img0 = document.createElement("img");
      img0.src = "/airo-assets/images/pages/home/hero-1";
      slide0.appendChild(img0);

      const slide1 = document.createElement("div");
      slide1.setAttribute("aria-roledescription", "slide");
      const img1 = document.createElement("img");
      img1.src = "/airo-assets/images/pages/home/hero-2";
      slide1.appendChild(img1);

      carousel.append(slide0, slide1);
      document.body.appendChild(carousel);

      (window as Window & { __airoCarouselSlotEditActive?: boolean }).__airoCarouselSlotEditActive = true;
      (window as Window & { __airoCarouselSlotEditRoot?: HTMLElement | null }).__airoCarouselSlotEditRoot = carousel;

      syncMediaPanelToCarouselSlide(1);

      expect(vi.mocked(send)).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "OPEN_MEDIA_SLOT_DIALOG",
          slotName: "pages/home/hero-2",
          skipPreviewScroll: true,
        }),
      );
    });
  });
});
