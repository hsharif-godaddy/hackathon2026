import React from "react";
import { Check, X } from "lucide-react";
import { t } from "../utils/translations";
import { diffWords, type DiffPart } from "../utils/word-diff";

interface TextFixPopoverProps {
  oldText: string;
  newText: string;
  onAccept: () => void;
  onReject: () => void;
  /** Positioning styles set by parent (anchored under the toolbar). */
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const CONTAINER_STYLES: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  background: "rgba(255, 255, 255, 0.95)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  padding: "10px",
  borderRadius: "10px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.2)",
  zIndex: 10001,
  pointerEvents: "auto",
  fontFamily: "system-ui, sans-serif",
  fontSize: "13px",
  color: "#111827",
  maxWidth: "360px",
  minWidth: "240px",
  animation: "editBarFadeIn 0.15s ease-out",
};

const DIFF_BOX_STYLES: React.CSSProperties = {
  padding: "8px 10px",
  background: "rgba(243, 244, 246, 0.7)",
  borderRadius: "6px",
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const ADDED_STYLES: React.CSSProperties = {
  background: "rgba(34, 197, 94, 0.18)",
  color: "#15803d",
  borderRadius: "2px",
  padding: "0 1px",
};

const REMOVED_STYLES: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.12)",
  color: "#b91c1c",
  textDecoration: "line-through",
  borderRadius: "2px",
  padding: "0 1px",
};

const ACTIONS_STYLES: React.CSSProperties = {
  display: "flex",
  gap: "6px",
  justifyContent: "flex-end",
};

const BUTTON_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "5px 10px",
  border: "none",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "system-ui, sans-serif",
};

const ACCEPT_BTN_STYLES: React.CSSProperties = {
  ...BUTTON_BASE,
  background: "#111827",
  color: "#fff",
};

const REJECT_BTN_STYLES: React.CSSProperties = {
  ...BUTTON_BASE,
  background: "rgba(243, 244, 246, 0.9)",
  color: "#374151",
};

function renderDiff(parts: DiffPart[]): React.ReactNode {
  return parts.map((part, idx) => {
    if (part.type === "added") {
      return (
        <span key={idx} style={ADDED_STYLES}>
          {part.text}
        </span>
      );
    }
    if (part.type === "removed") {
      return (
        <span key={idx} style={REMOVED_STYLES}>
          {part.text}
        </span>
      );
    }
    return <React.Fragment key={idx}>{part.text}</React.Fragment>;
  });
}

export function TextFixPopover({
  oldText,
  newText,
  onAccept,
  onReject,
  style,
  onMouseEnter,
  onMouseLeave,
}: TextFixPopoverProps) {
  const parts = diffWords(oldText, newText);

  return (
    <div
      data-airo-dev-tools=""
      data-testid="text-fix-popover"
      className="edit-mode-hover-bar"
      style={{ ...CONTAINER_STYLES, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div data-testid="text-fix-diff" style={DIFF_BOX_STYLES}>{renderDiff(parts)}</div>
      <div style={ACTIONS_STYLES}>
        <button
          type="button"
          data-testid="text-fix-reject"
          style={REJECT_BTN_STYLES}
          onClick={(e) => {
            e.stopPropagation();
            onReject();
          }}
        >
          <X width={13} height={13} />
          {t("devtools_text_fix_reject", "Reject")}
        </button>
        <button
          type="button"
          data-testid="text-fix-accept"
          style={ACCEPT_BTN_STYLES}
          onClick={(e) => {
            e.stopPropagation();
            onAccept();
          }}
        >
          <Check width={13} height={13} />
          {t("devtools_text_fix_accept", "Accept")}
        </button>
      </div>
    </div>
  );
}
