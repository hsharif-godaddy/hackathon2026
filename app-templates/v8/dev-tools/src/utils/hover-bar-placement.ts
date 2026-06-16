import type { CSSProperties } from "react";

export const OUTLINE_PAD = 8;

const GAP = 8;
const EDGE_MARGIN = 16;
const MIN_CLEARANCE_ABOVE = 200;
const BAR_STACK_GAP = 6;
const ESTIMATED_TOOLBAR_WIDTH = 350;
const ESTIMATED_LINK_BAR_WIDTH = 280;
const ESTIMATED_TOOLBAR_HEIGHT = 40;
const ESTIMATED_LINK_BAR_HEIGHT = 32;

export interface Bounds {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export type VerticalPlacement = "above" | "below";

export interface PlacedBarStyle {
  style: CSSProperties;
  placement: VerticalPlacement;
}

function horizontalPosition(
  bounds: Bounds,
  estimatedBarWidth: number,
  viewportWidth: number,
): { left: string; horizontalTransform: string } {
  const centerX = bounds.left + bounds.width / 2;
  const halfBarWidth = estimatedBarWidth / 2;
  let leftPos = centerX;
  let horizontalTransform = "translateX(-50%)";

  if (centerX - halfBarWidth < EDGE_MARGIN) {
    leftPos = bounds.left;
    horizontalTransform = "translateX(0)";
  } else if (centerX + halfBarWidth > viewportWidth - EDGE_MARGIN) {
    leftPos = bounds.right;
    horizontalTransform = "translateX(-100%)";
  }

  return {
    left: `${leftPos}px`,
    horizontalTransform,
  };
}

function combineTransform(horizontalTransform: string, flipAbove: boolean): string {
  if (!flipAbove) return horizontalTransform;

  if (horizontalTransform === "translateX(-50%)") return "translate(-50%, -100%)";
  if (horizontalTransform === "translateX(0)") return "translate(0, -100%)";
  return "translate(-100%, -100%)";
}

function fitsBelow(top: number, viewportHeight: number): boolean {
  return top + ESTIMATED_LINK_BAR_HEIGHT <= viewportHeight - EDGE_MARGIN;
}

function fitsAbove(anchor: number): boolean {
  return anchor - ESTIMATED_LINK_BAR_HEIGHT >= EDGE_MARGIN;
}

export function computeHoverBarStyle(
  bounds: Bounds,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight },
): PlacedBarStyle {
  const hasSpaceAbove = bounds.top > MIN_CLEARANCE_ABOVE;
  const horizontal = horizontalPosition(bounds, ESTIMATED_TOOLBAR_WIDTH, viewport.width);

  const style: CSSProperties = {
    position: "fixed",
    left: horizontal.left,
    transform: horizontal.horizontalTransform,
  };

  if (hasSpaceAbove) {
    style.top = `${bounds.top - GAP - OUTLINE_PAD}px`;
    style.transform = combineTransform(horizontal.horizontalTransform, true);
    return { style, placement: "above" };
  }

  style.top = `${bounds.bottom + GAP + OUTLINE_PAD}px`;
  return { style, placement: "below" };
}

export function computeLinkFollowBarStyle(
  bounds: Bounds,
  toolbarPlacement: VerticalPlacement,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight },
): PlacedBarStyle {
  const horizontal = horizontalPosition(bounds, ESTIMATED_LINK_BAR_WIDTH, viewport.width);
  const belowElementTop = bounds.bottom + GAP + OUTLINE_PAD;
  const stackedBelowTop = bounds.bottom + GAP + OUTLINE_PAD + ESTIMATED_TOOLBAR_HEIGHT + BAR_STACK_GAP;
  const aboveElementAnchor = bounds.top - GAP - OUTLINE_PAD;

  let placement: VerticalPlacement = "below";
  let top = toolbarPlacement === "above" ? belowElementTop : stackedBelowTop;

  if (!fitsBelow(top, viewport.height)) {
    placement = "above";
    top = aboveElementAnchor;
  }

  const style: CSSProperties = {
    position: "fixed",
    left: horizontal.left,
    top: `${top}px`,
    transform: combineTransform(horizontal.horizontalTransform, placement === "above"),
  };

  if (placement === "above" && !fitsAbove(top)) {
    style.top = `${EDGE_MARGIN + ESTIMATED_LINK_BAR_HEIGHT}px`;
  }

  return { style, placement };
}
