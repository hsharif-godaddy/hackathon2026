import { useCallback, useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { FontOption, FontList, primaryFontName } from "../utils/getFontList";

export interface FontPickerProps {
  /** Font list with theme and custom sections. */
  fontList: FontList;
  /** CSS font-family string of the currently active font (for highlight). */
  activeFont: string;
  /** Called when the user picks a font. */
  onSelect: (font: FontOption) => void;
  /** Called on pointerdown outside the picker or Escape key. */
  onClickOutside?: () => void;
}

/**
 * Standalone font picker popover — displays theme fonts and custom fonts
 * in a scrollable dropdown. Mirrors the ColorPicker pattern: the parent
 * (`FontFamilyButton`) owns element state and commit logic; this component
 * is purely presentational + dismissal.
 */
export default function FontPicker({ fontList, activeFont, onSelect, onClickOutside }: FontPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((font: FontOption) => {
    onSelect(font);
  }, [onSelect]);

  // Click-outside and Escape to close (mirrors ColorPicker).
  useEffect(() => {
    if (!onClickOutside) return;
    const handlePointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClickOutside();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClickOutside]);

  return (
    <div
      ref={rootRef}
      data-airo-dev-tools=""
      style={{
        background: "#fff",
        borderRadius: "12px",
        border: "1px solid rgba(0,0,0,0.1)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.2)",
        padding: "6px",
        width: "max-content",
        minWidth: "240px",
        maxWidth: "320px",
        maxHeight: "360px",
        overflowY: "auto",
      }}
    >
      {fontList.theme.length > 0 && (
        <>
          <SectionLabel>Theme Fonts</SectionLabel>
          {fontList.theme.map((font) => (
            <FontRow key={font.value} font={font} onSelect={handleSelect} isActive={isFontActive(font.value, activeFont)} />
          ))}
        </>
      )}
      {fontList.recent.length > 0 && (
        <>
          {fontList.theme.length > 0 && <Divider />}
          <SectionLabel>Recent</SectionLabel>
          {fontList.recent.map((font) => (
            <FontRow key={font.value} font={font} onSelect={handleSelect} isActive={isFontActive(font.value, activeFont)} />
          ))}
        </>
      )}
      {fontList.custom.length > 0 && (
        <>
          {(fontList.theme.length > 0 || fontList.recent.length > 0) && <Divider />}
          <SectionLabel>Custom Fonts</SectionLabel>
          {fontList.custom.map((font) => (
            <FontRow key={font.value} font={font} onSelect={handleSelect} isActive={isFontActive(font.value, activeFont)} />
          ))}
        </>
      )}
      {fontList.theme.length === 0 && fontList.custom.length === 0 && (
        <div style={{ padding: "8px 12px", fontSize: "13px", color: "#6b7280" }}>
          No fonts available
        </div>
      )}
    </div>
  );
}

// ── Internal helpers ──

/**
 * Check if a font value matches the currently active computed font-family.
 * Compares by extracting the primary font name from each stack.
 */
function isFontActive(fontValue: string, computedFont: string): boolean {
  if (!computedFont) return false;
  const primary = primaryFontName(fontValue).toLowerCase();
  const activePrimary = primaryFontName(computedFont).toLowerCase();
  return primary === activePrimary;
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div
      style={{
        padding: "6px 12px 2px",
        fontSize: "11px",
        fontWeight: 600,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}

function Divider() {
  return (
    <div style={{ height: "1px", background: "#e5e7eb", margin: "4px 8px" }} />
  );
}

function FontRow({ font, onSelect, isActive }: { font: FontOption; onSelect: (f: FontOption) => void; isActive: boolean }) {
  return (
    <button
      onClick={() => onSelect(font)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 12px",
        border: "none",
        background: isActive ? "#f0f5ff" : "transparent",
        borderRadius: "8px",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: font.value,
        fontSize: "15px",
        lineHeight: "1.4",
        color: isActive ? "#2563eb" : "#1a1a1a",
        gap: "8px",
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "#f3f4f6";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = isActive ? "#f0f5ff" : "transparent";
      }}
      title={font.value}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{font.label}</span>
      {isActive && <Check width={14} height={14} style={{ flexShrink: 0, color: "#2563eb" }} />}
    </button>
  );
}
