/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";

import { Tooltip } from "../Tooltip";

describe("Tooltip", function tooltipTests() {
  beforeEach(function setup() {
    vi.useFakeTimers();
  });

  afterEach(function teardown() {
    cleanup();
    vi.useRealTimers();
  });

  it("shows portaled bubble immediately on hover with default delay", function instantShow() {
    render(
      createElement(
        Tooltip,
        { content: "Toggle bold" },
        createElement("button", { type: "button" }, "B"),
      ),
    );

    fireEvent.mouseEnter(document.querySelector(".airo-tooltip-root")!);
    vi.runAllTimers();

    const bubble = document.body.querySelector(".airo-tooltip-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain("Toggle bold");
  });

  it("does not show bubble while disabled", function disabledSuppresses() {
    render(
      createElement(
        Tooltip,
        { content: "Text color", disabled: true },
        createElement("button", { type: "button" }, "C"),
      ),
    );

    fireEvent.mouseEnter(document.querySelector(".airo-tooltip-root")!);
    vi.runAllTimers();

    expect(document.body.querySelector(".airo-tooltip-bubble")).toBeNull();
  });

  it("respects custom show delay", function customDelay() {
    render(
      createElement(
        Tooltip,
        { content: "Delayed", delayMs: 200 },
        createElement("button", { type: "button" }, "D"),
      ),
    );

    fireEvent.mouseEnter(document.querySelector(".airo-tooltip-root")!);
    vi.advanceTimersByTime(199);
    expect(document.body.querySelector(".airo-tooltip-bubble")).toBeNull();

    vi.advanceTimersByTime(1);
    expect(document.body.querySelector(".airo-tooltip-bubble")).not.toBeNull();
  });

  it("hides bubble after pointer leave", function hideOnLeave() {
    render(
      createElement(
        Tooltip,
        { content: "Toggle italic" },
        createElement("button", { type: "button" }, "I"),
      ),
    );

    const root = document.querySelector(".airo-tooltip-root")!;
    fireEvent.mouseEnter(root);
    vi.runAllTimers();
    expect(document.body.querySelector(".airo-tooltip-bubble")).not.toBeNull();

    fireEvent.mouseLeave(root);
    vi.runAllTimers();

    expect(document.body.querySelector(".airo-tooltip-bubble")).toBeNull();
  });

  it("strips native title from the trigger to prevent double tooltips", function stripNativeTitle() {
    render(
      createElement(
        Tooltip,
        { content: "Text color" },
        createElement("button", { type: "button", title: "Text color" }, "C"),
      ),
    );

    expect(document.querySelector("button")).not.toHaveAttribute("title");
  });

  it("keeps native title on the trigger when disabled", function keepNativeTitleWhenDisabled() {
    render(
      createElement(
        Tooltip,
        { content: "Text color", disabled: true },
        createElement("button", { type: "button", title: "Text color" }, "C"),
      ),
    );

    expect(document.querySelector("button")).toHaveAttribute("title", "Text color");
  });

  it("portals bubble into the dev-tools root when present", function portalIntoDevToolsRoot() {
    const devToolsRoot = document.createElement("div");
    devToolsRoot.id = "airo-dev-tools-injected";
    document.body.appendChild(devToolsRoot);

    try {
      render(
        createElement(
          Tooltip,
          { content: "Decrease text size" },
          createElement("button", { type: "button" }, "−"),
        ),
      );

      fireEvent.mouseEnter(document.querySelector(".airo-tooltip-root")!);
      vi.runAllTimers();

      // Bubble must live inside the dev-tools root so its z-index can stack
      // above the HoverBar (10000) without competing with the root's max
      // z-index from outside.
      const bubble = devToolsRoot.querySelector(".airo-tooltip-bubble");
      expect(bubble).not.toBeNull();
      expect(bubble?.parentElement).toBe(devToolsRoot);
    } finally {
      devToolsRoot.remove();
    }
  });
});
