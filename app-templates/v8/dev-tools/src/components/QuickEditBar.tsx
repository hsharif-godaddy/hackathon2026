import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, X } from "lucide-react";
import { t } from "../utils/translations";
import { HoverBar } from "./HoverBar";

interface SpeechController {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  toggle: () => void;
}

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

const MIC_BTN_BASE_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  padding: "0",
  border: "1px solid #e5e7eb",
  borderRadius: "7px",
  cursor: "pointer",
  flexShrink: 0,
};

interface QuickEditBarProps {
  onSubmit: (prompt: string) => void;
  onDismiss: () => void;
  /** Positioning styles (`position`, `top`/`bottom`/`left`/`right`). */
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Optional speech-to-text controller. When omitted or `isSupported` is
   *  false, the mic button is not rendered. */
  speech?: SpeechController;
}

export function QuickEditBar({
  onSubmit,
  onDismiss,
  style,
  onMouseEnter,
  onMouseLeave,
  speech,
}: QuickEditBarProps) {
  const [value, setValue] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const baseTextRef = useRef<string>("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Append speech transcript to whatever the user had typed before starting.
  // Mirrors ChatInput's textBeforeListeningRef behavior.
  useEffect(function captureBaseTextOnListenStart() {
    if (speech?.isListening) baseTextRef.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech?.isListening]);

  useEffect(function applyTranscriptToInput() {
    if (!speech?.isListening || !speech.transcript) return;
    const base = baseTextRef.current;
    const separator = base && !base.endsWith(" ") ? " " : "";
    setValue(base + separator + speech.transcript);
  }, [speech?.isListening, speech?.transcript]);

  // Stop speech on every unmount path (mic UI lives here, so unmount = no
  // off-switch). Ref so the cleanup reads the latest controller.
  const speechRef = useRef(speech);
  speechRef.current = speech;
  useEffect(function stopSpeechOnUnmount() {
    return () => {
      if (speechRef.current?.isListening) speechRef.current.toggle();
    };
  }, []);

  const handleSubmit = (): void => {
    if (speech?.isListening) speech.toggle();
    if (value.trim()) onSubmit(value.trim());
  };

  const handleDismiss = (): void => {
    if (speech?.isListening) speech.toggle();
    onDismiss();
  };

  const showMic = Boolean(speech?.isSupported);
  const isListening = Boolean(speech?.isListening);

  return (
    <HoverBar
      style={{
        alignItems: "center",
        padding: "4px 4px 4px 8px",
        minWidth: "320px",
        gap: "4px",
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
        onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
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
          // The bar renders into the host app's document. Keep keystrokes from
          // reaching the app's global key handlers — e.g. a slide deck that
          // advances on spacebar / arrow keys. React's stopPropagation also
          // stops the native event, so document/window listeners never fire.
          e.stopPropagation();
          if (e.key === "Enter" && value.trim()) handleSubmit();
          if (e.key === "Escape") handleDismiss();
        }}
        onKeyUp={(e) => { e.stopPropagation(); }}
      />
      {showMic && (
        <button
          type="button"
          data-airo-dev-tools=""
          aria-pressed={isListening}
          title={
            isListening
              ? t("devtools_quick_edit_stop_listening", "Stop listening")
              : t("devtools_quick_edit_start_listening", "Start listening")
          }
          style={{
            ...MIC_BTN_BASE_STYLES,
            background: isListening ? "#dc2626" : "transparent",
            color: isListening ? "#fff" : "#6b7280",
          }}
          onClick={(e) => { e.stopPropagation(); speech!.toggle(); }}
        >
          <Mic width={14} height={14} />
        </button>
      )}
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
