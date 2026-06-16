import React, { useCallback } from "react";
import { Link2 } from "lucide-react";

import type { FollowTarget } from "../utils/link-follow";
import type { VerticalPlacement } from "../utils/hover-bar-placement";
import { t } from "../utils/translations";

const BAR_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 10px",
  background: "rgba(17, 24, 39, 0.94)",
  borderRadius: "8px",
  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.08)",
  color: "#f9fafb",
  fontFamily: "system-ui, sans-serif",
  fontSize: "12px",
  fontWeight: 500,
  lineHeight: 1.2,
  maxWidth: "min(360px, calc(100vw - 32px))",
};

const ACTION_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  font: "inherit",
  minWidth: 0,
};

const DESTINATION_STYLES: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
};

interface LinkFollowBarProps {
  style: React.CSSProperties;
  placement?: VerticalPlacement;
  target: FollowTarget;
  onFollow: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function LinkFollowBar({
  style,
  placement = "below",
  target,
  onFollow,
  onMouseEnter,
  onMouseLeave,
}: LinkFollowBarProps) {
  const destinationLabel = target.kind === "link"
    ? `${t("devtools_goto_link_prefix", "Go to:")} ${target.displayUrl}`
    : t("devtools_test_button", "Test button");

  const followTitle = target.kind === "link"
    ? t("devtools_follow_link_title", "Follow link")
    : t("devtools_test_button_title", "Test button");

  const handleFollow = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    onFollow();
  }, [onFollow]);

  return (
    <div
      data-airo-dev-tools
      className="edit-mode-link-follow-bar"
      style={{
        position: "fixed",
        zIndex: 10000,
        pointerEvents: "auto",
        animation: "editBarFadeIn 0.15s ease-out",
        ...style,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        aria-hidden="true"
        style={
          placement === "above"
            ? {
                position: "absolute",
                bottom: "-5px",
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderTop: "6px solid rgba(17, 24, 39, 0.94)",
              }
            : {
                position: "absolute",
                top: "-5px",
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "6px solid transparent",
                borderRight: "6px solid transparent",
                borderBottom: "6px solid rgba(17, 24, 39, 0.94)",
              }
        }
      />
      <div style={BAR_STYLES}>
        <button
          type="button"
          aria-label={followTitle}
          data-testid="devtools-link-follow-icon"
          style={ACTION_STYLES}
          onClick={handleFollow}
        >
          <Link2 width={14} height={14} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          aria-label={destinationLabel}
          data-testid="devtools-link-follow-destination"
          style={{ ...ACTION_STYLES, flex: 1, minWidth: 0 }}
          onClick={handleFollow}
        >
          <span style={DESTINATION_STYLES}>{destinationLabel}</span>
        </button>
      </div>
    </div>
  );
}
