import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Globe, Link2, Trash2, X } from "lucide-react";
import { t } from "../utils/translations";
import { discoverRoutes } from "../route-discovery";

export interface ExistingLinkInfo {
  href: string;
  isInternal: boolean;
}

interface ImageActionPopoverProps {
  onSubmit: (prompt: string) => void;
  onDismiss: () => void;
  style?: React.CSSProperties;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Current click wrapper, if any — surfaced as the "Opens link …" pill. */
  existingLink?: ExistingLinkInfo | null;
  /** True when this <img> is rendered inside a .map() loop — triggers per-item prompt guidance. */
  isLoopRendered?: boolean;
  /** Identifies the targeted <img> for the agent (used in the prompt to disambiguate loop siblings). */
  targetAlt?: string;
  targetSrc?: string;
}

type Mode = "menu" | "link" | "page";

interface RouteOption {
  path: string;
  modulePath: string | null;
  name: string;
}

export function friendlyPageName(path: string): string {
  if (path === "/") return t("devtools_image_action_page_home", "Home");
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? path;
  return last
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  width: "320px",
  animation: "editBarFadeIn 0.15s ease-out",
};

const HEADER_ROW_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
};

const SUBVIEW_HEADER_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  minWidth: 0,
};

const HEADER_LABEL_STYLES: React.CSSProperties = {
  fontWeight: 600,
  color: "#111827",
};

const ICON_BUTTON_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "24px",
  height: "24px",
  padding: 0,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#9ca3af",
  borderRadius: "5px",
  flexShrink: 0,
};

const QUICK_ACTION_ROW_STYLES: React.CSSProperties = {
  display: "flex",
  gap: "6px",
};

const QUICK_ACTION_BTN_STYLES: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "4px",
  padding: "8px 6px",
  background: "rgba(243, 244, 246, 0.9)",
  border: "1px solid rgba(0,0,0,0.04)",
  borderRadius: "7px",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 600,
  color: "#374151",
  fontFamily: "system-ui, sans-serif",
};

const DIVIDER_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  fontSize: "11px",
  color: "#9ca3af",
  margin: "2px 0",
};

const DIVIDER_LINE_STYLES: React.CSSProperties = {
  flex: 1,
  height: "1px",
  background: "#e5e7eb",
};

const INPUT_ROW_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "4px 4px 4px 8px",
  background: "rgba(243, 244, 246, 0.9)",
  borderRadius: "8px",
};

const INPUT_STYLES: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  outline: "none",
  background: "transparent",
  fontSize: "13px",
  color: "#111827",
  fontFamily: "system-ui, sans-serif",
};

const SELECT_STYLES: React.CSSProperties = {
  ...INPUT_STYLES,
  appearance: "auto",
  cursor: "pointer",
};

const SEND_BTN_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "28px",
  height: "28px",
  padding: 0,
  background: "#111827",
  border: "none",
  borderRadius: "7px",
  cursor: "pointer",
  color: "#fff",
  flexShrink: 0,
};

const HINT_STYLES: React.CSSProperties = {
  fontSize: "11px",
  color: "#6b7280",
};

const CURRENT_PILL_STYLES: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  padding: "6px 8px",
  background: "rgba(139, 92, 246, 0.08)",
  border: "1px solid rgba(139, 92, 246, 0.18)",
  borderRadius: "7px",
  fontSize: "11px",
  color: "#4c1d95",
  minWidth: 0,
};

const CURRENT_LABEL_STYLES: React.CSSProperties = {
  fontWeight: 600,
  flexShrink: 0,
};

const CURRENT_TARGET_STYLES: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

// JSON.stringify produces a properly-escaped, double-quoted string literal
// — safe to drop into prompt text without prompt-injection from quotes.
const q = (s: string): string => JSON.stringify(s ?? "");

function loopGuidance(targetAlt: string, targetSrc: string, existingSharedHref: string | null): string {
  const targetLine = ` The targeted image is the data entry whose name/alt/title matches ${q(targetAlt)} (its slot/src/image field contains ${q(targetSrc)}). Match by this alt text — never by array index or source order.`;
  const preserve = existingSharedHref
    ? ` Every sibling currently shares the same wrapper that points to ${q(existingSharedHref)}. Before changing anything, initialize each non-target sibling's link field to ${q(existingSharedHref)} so their behavior is preserved. Only the entry matching ${q(targetAlt)} may change.`
    : "";
  return ` IMPORTANT: this <img> is rendered inside a .map() loop, so all iterations share the same JSX. Do NOT wrap the <img> directly inside the loop — that attaches the same action to every sibling. Refactor to a per-item pattern: add an optional link field (e.g. \`link?: string\`) to the data entry, render conditionally — e.g. \`{item.link ? <a href={item.link} target="_blank" rel="noopener"><img .../></a> : <img .../>}\` — and apply the change to ONLY that one entry.${targetLine}${preserve} If a previous edit wrapped the <img> directly inside the loop, undo that shared wrap as part of this refactor.`;
}

const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

export function normalizeExternalUrl(raw: string): { url: string } | { error: "blocked-scheme" | "invalid" } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "invalid" };
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!schemeMatch) {
    if (trimmed.startsWith("//") || trimmed.startsWith("/")) return { error: "invalid" };
    return { url: `https://${trimmed}` };
  }
  const scheme = schemeMatch[1]!.toLowerCase();
  return ALLOWED_LINK_SCHEMES.has(scheme) ? { url: trimmed } : { error: "blocked-scheme" };
}

export function buildLinkPrompt(url: string, loopRendered: boolean, targetAlt: string, targetSrc: string, existingSharedHref: string | null): string {
  const base = `When the C2 clicks the image with alt=${q(targetAlt)}, navigate to ${q(url)}. Wrap that image in an <a> tag with target="_blank" and rel="noopener". Keep all existing styling and alt text.`;
  return loopRendered ? base + loopGuidance(targetAlt, targetSrc, existingSharedHref) : base;
}

export function buildPagePrompt(path: string, loopRendered: boolean, targetAlt: string, targetSrc: string, existingSharedHref: string | null): string {
  const base = `When the C2 clicks the image with alt=${q(targetAlt)}, navigate to the route ${q(path)}. Wrap that image in the React Router Link component (import from src/router or react-router-dom as the project already uses). Keep all existing styling and alt text.`;
  return loopRendered ? base + loopGuidance(targetAlt, targetSrc, existingSharedHref) : base;
}

export function buildClearPrompt(loopRendered: boolean, targetAlt: string, targetSrc: string, existingSharedHref: string | null): string {
  const base = `Remove any link or click action currently wrapping the image with alt=${q(targetAlt)} so it is no longer clickable. Keep the image element and its styling intact.`;
  return loopRendered ? base + loopGuidance(targetAlt, targetSrc, existingSharedHref) : base;
}

export function buildFreeformPrompt(userText: string, loopRendered: boolean, targetAlt: string, targetSrc: string): string {
  const base = `When the C2 clicks the image with alt=${q(targetAlt)} (src contains ${q(targetSrc)}), ${userText.trim()}. This must be wired as a CLICK INTERACTION on that specific image — attach an onClick handler (using React state where needed) so the behavior triggers only when the user clicks the image. CRITICAL: do NOT change the image's default or initial appearance. The image must render in its current form on page load and only change as a result of the user clicking it.`;
  const loopHint = loopRendered
    ? ` IMPORTANT: this <img> is rendered inside a .map() loop, so all iterations share the same JSX. The behavior must apply to ONLY the entry whose alt/name field matches ${q(targetAlt)} (its image field contains ${q(targetSrc)}) — match by this alt text, never by array index. If the behavior involves state, scope state per item (e.g. keyed by the item's id) so clicking one image does not affect siblings.`
    : "";
  return base + loopHint;
}

export function ImageActionPopover({
  onSubmit,
  onDismiss,
  style,
  onMouseEnter,
  onMouseLeave,
  existingLink = null,
  isLoopRendered = false,
  targetAlt = "",
  targetSrc = "",
}: ImageActionPopoverProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const [linkUrl, setLinkUrl] = useState(existingLink && !existingLink.isInternal ? existingLink.href : "");
  const [pagePath, setPagePath] = useState(existingLink && existingLink.isInternal ? existingLink.href : "");
  const hasExistingAction = !!existingLink;
  const [pages, setPages] = useState<RouteOption[] | null>(null);
  const [pagesError, setPagesError] = useState(false);
  const [freeform, setFreeform] = useState("");
  const [linkError, setLinkError] = useState<"blocked-scheme" | "invalid" | null>(null);

  const linkInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line no-undef -- dev-tools eslint env ships HTMLInputElement but not HTMLTextAreaElement; React's textarea ref typing requires the specific element type.
  const freeformRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === "link") linkInputRef.current?.focus();
    if (mode === "menu") freeformRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== "page" || pages !== null) return;
    let cancelled = false;
    discoverRoutes()
      .then((manifest) => {
        if (cancelled) return;
        const opts = manifest.routes
          .filter((r) => r.path && !r.path.includes("*") && !r.path.includes(":"))
          .map((r) => ({ path: r.path, modulePath: r.modulePath, name: friendlyPageName(r.path) }))
          .sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.name.localeCompare(b.name)));
        setPages(opts);
        if (opts.length > 0 && !pagePath) setPagePath(opts[0]!.path);
      })
      .catch(() => {
        if (!cancelled) setPagesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, pages, pagePath]);

  const sharedHref = existingLink?.href ?? null;

  const submitLink = (): void => {
    const result = normalizeExternalUrl(linkUrl);
    if ("error" in result) {
      setLinkError(result.error);
      return;
    }
    setLinkError(null);
    onSubmit(buildLinkPrompt(result.url, isLoopRendered, targetAlt, targetSrc, sharedHref));
  };

  const submitPage = (): void => {
    const path = pagePath.trim();
    if (!path) return;
    onSubmit(buildPagePrompt(path, isLoopRendered, targetAlt, targetSrc, sharedHref));
  };

  const submitFreeform = (): void => {
    const value = freeform.trim();
    if (!value) return;
    onSubmit(buildFreeformPrompt(value, isLoopRendered, targetAlt, targetSrc));
  };

  const stop = (e: React.SyntheticEvent): void => {
    e.stopPropagation();
  };

  return (
    <div
      data-airo-dev-tools=""
      data-testid="image-action-popover"
      className="edit-mode-hover-bar"
      style={{ ...CONTAINER_STYLES, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={stop}
    >
      <div style={HEADER_ROW_STYLES}>
        {mode === "menu" ? (
          <span style={HEADER_LABEL_STYLES}>
            {hasExistingAction
              ? t("devtools_image_action_title_change", "Change what happens on click")
              : t("devtools_image_action_title", "When clicked, this image should…")}
          </span>
        ) : (
          <div style={SUBVIEW_HEADER_STYLES}>
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-back"
              title={t("devtools_image_action_back", "Back")}
              style={ICON_BUTTON_STYLES}
              onClick={(e) => {
                stop(e);
                setMode("menu");
              }}
            >
              <ArrowLeft width={14} height={14} />
            </button>
            <span style={HEADER_LABEL_STYLES}>
              {mode === "link"
                ? t("devtools_image_action_subtitle_link", "Opens link")
                : t("devtools_image_action_subtitle_page", "Opens page")}
            </span>
          </div>
        )}
        <button
          type="button"
          data-airo-dev-tools=""
          data-testid="image-action-dismiss"
          title={t("devtools_image_action_dismiss", "Dismiss")}
          style={ICON_BUTTON_STYLES}
          onClick={(e) => {
            stop(e);
            onDismiss();
          }}
        >
          <X width={14} height={14} />
        </button>
      </div>

      {mode === "menu" && (
        <>
          {hasExistingAction && (
            <div data-testid="image-action-current" style={CURRENT_PILL_STYLES}>
              <span style={CURRENT_LABEL_STYLES}>
                {existingLink!.isInternal
                  ? t("devtools_image_action_current_page", "Opens page")
                  : t("devtools_image_action_current_link", "Opens link")}
              </span>
              <span style={CURRENT_TARGET_STYLES} title={existingLink!.href}>
                {existingLink!.href}
              </span>
            </div>
          )}
          <div style={QUICK_ACTION_ROW_STYLES}>
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-set-link"
              style={QUICK_ACTION_BTN_STYLES}
              onClick={(e) => {
                stop(e);
                setMode("link");
              }}
            >
              <Link2 width={16} height={16} />
              {hasExistingAction
                ? t("devtools_image_action_link_change", "Change link")
                : t("devtools_image_action_link", "Open link")}
            </button>
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-set-page"
              style={QUICK_ACTION_BTN_STYLES}
              onClick={(e) => {
                stop(e);
                setMode("page");
              }}
            >
              <Globe width={16} height={16} />
              {hasExistingAction
                ? t("devtools_image_action_page_change", "Change page")
                : t("devtools_image_action_page", "Open page")}
            </button>
            {hasExistingAction && (
              <button
                type="button"
                data-airo-dev-tools=""
                data-testid="image-action-clear"
                style={QUICK_ACTION_BTN_STYLES}
                onClick={(e) => {
                  stop(e);
                  onSubmit(buildClearPrompt(isLoopRendered, targetAlt, targetSrc, sharedHref));
                }}
              >
                <Trash2 width={16} height={16} />
                {t("devtools_image_action_clear", "Clear")}
              </button>
            )}
          </div>

          <div style={DIVIDER_STYLES}>
            <div style={DIVIDER_LINE_STYLES} />
            {t("devtools_image_action_or", "or")}
            <div style={DIVIDER_LINE_STYLES} />
          </div>

          <div style={INPUT_ROW_STYLES}>
            <textarea
              ref={freeformRef}
              data-airo-dev-tools=""
              data-testid="image-action-freeform"
              value={freeform}
              onChange={(e) => {
                setFreeform(e.target.value);
              }}
              placeholder={t(
                "devtools_image_action_freeform_placeholder",
                "Tell the agent what should happen on click…",
              )}
              rows={2}
              style={{ ...INPUT_STYLES, resize: "none", paddingTop: "6px" }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey && freeform.trim()) {
                  e.preventDefault();
                  submitFreeform();
                }
                if (e.key === "Escape") onDismiss();
              }}
              onKeyUp={stop}
            />
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-freeform-send"
              title={t("devtools_image_action_send", "Send")}
              style={SEND_BTN_STYLES}
              onClick={(e) => {
                stop(e);
                submitFreeform();
              }}
            >
              <ArrowUp width={14} height={14} />
            </button>
          </div>
        </>
      )}

      {mode === "link" && (
        <>
          <div style={INPUT_ROW_STYLES}>
            <input
              ref={linkInputRef}
              data-airo-dev-tools=""
              data-testid="image-action-link-input"
              type="url"
              value={linkUrl}
              onChange={(e) => {
                setLinkUrl(e.target.value);
                if (linkError) setLinkError(null);
              }}
              placeholder={t(
                "devtools_image_action_link_placeholder",
                "https://example.com",
              )}
              style={INPUT_STYLES}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter" && linkUrl.trim()) submitLink();
                if (e.key === "Escape") setMode("menu");
              }}
              onKeyUp={stop}
            />
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-link-send"
              title={t("devtools_image_action_send", "Send")}
              style={SEND_BTN_STYLES}
              onClick={(e) => {
                stop(e);
                submitLink();
              }}
            >
              <ArrowUp width={14} height={14} />
            </button>
          </div>
          <div style={linkError ? { ...HINT_STYLES, color: "#b91c1c" } : HINT_STYLES} data-testid={linkError ? "image-action-link-error" : undefined}>
            {linkError === "blocked-scheme"
              ? t("devtools_image_action_link_error_scheme", "Only http, https, mailto, and tel links are allowed.")
              : linkError === "invalid"
              ? t("devtools_image_action_link_error_invalid", "Enter a full URL like https://example.com.")
              : t("devtools_image_action_link_hint", "Opens in a new tab.")}
          </div>
        </>
      )}

      {mode === "page" && (
        <>
          {pages === null && !pagesError && (
            <div style={HINT_STYLES}>
              {t("devtools_image_action_pages_loading", "Loading pages…")}
            </div>
          )}
          {pagesError && (
            <div style={HINT_STYLES}>
              {t(
                "devtools_image_action_pages_error",
                "Couldn't load pages. Type a path below.",
              )}
            </div>
          )}
          <div style={INPUT_ROW_STYLES}>
            {pages && pages.length > 0 ? (
              <select
                data-airo-dev-tools=""
                data-testid="image-action-page-select"
                value={pagePath}
                onChange={(e) => {
                  setPagePath(e.target.value);
                }}
                style={SELECT_STYLES}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && pagePath.trim()) submitPage();
                  if (e.key === "Escape") setMode("menu");
                }}
              >
                {pages.map((p) => (
                  <option key={p.path} value={p.path} title={p.path}>
                    {p.path === "/" ? `${p.name} (homepage)` : `${p.name} — ${p.path}`}
                  </option>
                ))}
              </select>
            ) : (
              <input
                data-airo-dev-tools=""
                data-testid="image-action-page-input"
                type="text"
                value={pagePath}
                onChange={(e) => {
                  setPagePath(e.target.value);
                }}
                placeholder={t(
                  "devtools_image_action_page_placeholder",
                  "/about",
                )}
                style={INPUT_STYLES}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" && pagePath.trim()) submitPage();
                  if (e.key === "Escape") setMode("menu");
                }}
                onKeyUp={stop}
              />
            )}
            <button
              type="button"
              data-airo-dev-tools=""
              data-testid="image-action-page-send"
              title={t("devtools_image_action_send", "Send")}
              style={SEND_BTN_STYLES}
              onClick={(e) => {
                stop(e);
                submitPage();
              }}
            >
              <ArrowUp width={14} height={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
