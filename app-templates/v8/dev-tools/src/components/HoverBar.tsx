import React from "react";

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
}

/**
 * Toolbar button for use inside a HoverBar.
 * Labeled (with text + icon) or icon-only depending on whether `label` is provided.
 */
export function HoverBarButton({ onClick, title, icon, label }: HoverBarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: label ? "5px" : undefined,
        padding: label ? "6px 10px" : "6px",
        background: "rgba(255, 255, 255, 0.9)",
        border: "none",
        borderRadius: "6px",
        cursor: "pointer",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        color: "var(--color-text-secondary)",
        ...(label ? { fontSize: "12px", fontWeight: 600, letterSpacing: "-0.01em" } : {}),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(245, 245, 245, 0.95)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255, 255, 255, 0.9)"; }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {icon}
      {label}
    </button>
  );
}
