import React, { useCallback, useRef, useState } from "react";

/** Shared glass-morphism pill container used by all hover bars. */
export const HOVER_BAR_CONTAINER_STYLES: React.CSSProperties = {
  display: "flex",
  gap: "4px",
  background: "rgba(255, 255, 255, 0.85)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  padding: "4px",
  borderRadius: "10px",
  boxShadow: "0 2px 12px rgba(0,0,0,0.15), 0 0 0 1px rgba(255,255,255,0.2)",
  zIndex: 10000,
  pointerEvents: "auto",
  fontFamily: "system-ui, sans-serif",
  animation: "editBarFadeIn 0.15s ease-out",
};

interface HoverBarProps {
  style: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  children: React.ReactNode;
}

export function HoverBar({ style, onMouseEnter, onMouseLeave, children }: HoverBarProps) {
  return (
    <div
      data-airo-dev-tools
      className="edit-mode-hover-bar"
      style={{ ...HOVER_BAR_CONTAINER_STYLES, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

interface HoverBarButtonProps {
  onClick: () => void;
  title: string;
  /** Icon element — pass with explicit size, e.g. `<Image width={15} height={15} />` */
  icon: React.ReactNode;
  /** When provided, renders a labeled button; omit for icon-only. */
  label?: string;
  /** When true, renders with active/toggled styling (blue tint). */
  active?: boolean;
  /** When true, renders dimmed and ignores clicks. */
  disabled?: boolean;
  /** Optional `data-testid` for E2E selectors. */
  testId?: string;
}

const TOOLTIP_STYLES: React.CSSProperties = {
  position: "absolute",
  bottom: "calc(100% + 6px)",
  left: "50%",
  transform: "translateX(-50%)",
  padding: "4px 8px",
  background: "rgba(30, 30, 30, 0.9)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  color: "#fff",
  fontSize: "11px",
  fontWeight: 500,
  borderRadius: "5px",
  whiteSpace: "nowrap",
  pointerEvents: "none",
  opacity: 0,
  transition: "opacity 0.15s ease",
};

/**
 * Toolbar button for use inside a HoverBar.
 * Labeled (with text + icon) or icon-only depending on whether `label` is provided.
 */
export function HoverBarButton({ onClick, title, icon, label, active, disabled, testId }: HoverBarButtonProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const baseBackground = active ? "rgba(59, 130, 246, 0.1)" : "rgba(255, 255, 255, 0.9)";
  const hoverBackground = active ? "rgba(59, 130, 246, 0.18)" : "rgba(245, 245, 245, 0.95)";
  const textColor = active ? "#2563eb" : "var(--color-text-secondary)";

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    // Skip the hover-background tint on disabled buttons (no interaction
    // affordance), but DO show the tooltip — when the stepper is disabled
    // because the element has an inline font-size override, the tooltip
    // is the only signal users have for *why* + and − are greyed out.
    if (!disabled) {
      e.currentTarget.style.background = hoverBackground;
    }
    delayRef.current = setTimeout(() => setShowTooltip(true), 400);
  }, [hoverBackground, disabled]);

  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.background = baseBackground;
    if (delayRef.current) clearTimeout(delayRef.current);
    setShowTooltip(false);
  }, [baseBackground]);

  return (
    <button
      type="button"
      // aria-disabled (not the native `disabled` attribute): some browsers
      // — Firefox most notably — suppress all pointer events on natively-
      // disabled buttons, which means the explanatory tooltip never fires.
      // We gate clicks ourselves below, so aria-disabled is enough for
      // semantics + keyboard behavior while keeping mouseenter/leave alive.
      aria-disabled={disabled || undefined}
      {...(label ? {} : { 'aria-label': title })}
      {...(testId ? { 'data-testid': testId } : {})}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: label ? "5px" : undefined,
        padding: label ? "6px 10px" : "6px",
        background: baseBackground,
        border: "none",
        borderRadius: "6px",
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        color: textColor,
        ...(label ? { fontSize: "12px", fontWeight: 600, letterSpacing: "-0.01em" } : {}),
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
    >
      {/* Disabled dimming lives on a wrapper around icon+label only.
          CSS `opacity` cascades to ALL descendants and a child can't override
          it, so applying it to the <button> made the tooltip translucent too.
          Scope to this span and the tooltip stays fully opaque. */}
      <span style={{
        display: "flex",
        alignItems: "center",
        gap: label ? "5px" : undefined,
        opacity: disabled ? 0.4 : 1,
      }}>
        {icon}
        {label}
      </span>
      <span aria-hidden="true" style={{ ...TOOLTIP_STYLES, opacity: showTooltip ? 1 : 0 }}>{title}</span>
    </button>
  );
}
