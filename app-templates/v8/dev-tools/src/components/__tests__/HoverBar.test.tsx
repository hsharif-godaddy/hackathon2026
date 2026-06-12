/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { createElement } from "react";
import { Bold } from "lucide-react";

import { HoverBarButton } from "../HoverBar";

describe("HoverBarButton", function hoverBarButtonTests() {
  beforeEach(function setup() {
    vi.useFakeTimers();
  });

  afterEach(function teardown() {
    cleanup();
    vi.useRealTimers();
  });

  it("does not set a native title on the trigger button", function noNativeTitle() {
    render(
      createElement(HoverBarButton, {
        onClick: vi.fn(),
        title: "Text color",
        icon: createElement(Bold, { width: 15, height: 15 }),
      }),
    );

    const button = document.querySelector("button");
    expect(button).not.toBeNull();
    expect(button).not.toHaveAttribute("title");
  });

  it("exposes the label via aria-label for icon-only buttons", function ariaLabel() {
    render(
      createElement(HoverBarButton, {
        onClick: vi.fn(),
        title: "Toggle bold",
        icon: createElement(Bold, { width: 15, height: 15 }),
      }),
    );

    expect(document.querySelector("button")).toHaveAttribute("aria-label", "Toggle bold");
  });

  it("shows the custom tooltip bubble on hover without a native title", function customTooltipOnly() {
    render(
      createElement(HoverBarButton, {
        onClick: vi.fn(),
        title: "Text color",
        icon: createElement(Bold, { width: 15, height: 15 }),
      }),
    );

    fireEvent.mouseEnter(document.querySelector(".airo-tooltip-root")!);
    vi.runAllTimers();

    const bubble = document.body.querySelector(".airo-tooltip-bubble");
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain("Text color");
    expect(document.querySelector("button")).not.toHaveAttribute("title");
  });
});
