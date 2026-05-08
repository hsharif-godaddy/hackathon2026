import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { t } from "../utils/translations";
import { HoverBar } from "./HoverBar";

const DISMISS_BTN_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  height: "24px",
  padding: "0",
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  borderRadius: "5px",
  flexShrink: 0,
};

const INPUT_STYLES: React.CSSProperties = {
  flex: "1",
  minWidth: "0",
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: "13px",
  color: "#111827",
  fontFamily: "system-ui, sans-serif",
};

const SEND_BTN_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  padding: "0",
  background: "#111827",
  border: "none",
  borderRadius: "7px",
  cursor: "pointer",
  color: "#fff",
  flexShrink: 0,
};

interface QuickEditBarProps {
  onSubmit: (prompt: string) => void;
  onDismiss: () => void;
  /** Positioning styles (`position`, `top`/`bottom`/`left`/`right`). */
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function QuickEditBar({
  onSubmit,
  onDismiss,
  style,
  onMouseEnter,
  onMouseLeave,
}: QuickEditBarProps) {
  const [value, setValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (): void => {
    if (value.trim()) onSubmit(value.trim());
  };

  return (
    <HoverBar
      style={{
        alignItems: "center",
        padding: "4px 4px 4px 8px",
        minWidth: "250px",
        gap: "10px",
        background: "rgba(255,255,255,0.95)",
        animation: "none",
        ...style,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        data-airo-dev-tools=""
        title={t("devtools_quick_edit_dismiss", "Dismiss")}
        style={DISMISS_BTN_STYLES}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#374151"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#9ca3af"; }}
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
      >
        <X width={14} height={14} />
      </button>
      <input
        ref={inputRef}
        data-airo-dev-tools=""
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); }}
        placeholder={t("devtools_quick_edit_placeholder", "Tell me how to change this...")}
        style={INPUT_STYLES}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) handleSubmit();
          if (e.key === "Escape") onDismiss();
        }}
      />
      <button
        type="button"
        data-airo-dev-tools=""
        title={t("devtools_quick_edit_send", "Send")}
        style={SEND_BTN_STYLES}
        onClick={(e) => { e.stopPropagation(); handleSubmit(); }}
      >
        <ArrowUp width={14} height={14} />
      </button>
    </HoverBar>
  );
}
