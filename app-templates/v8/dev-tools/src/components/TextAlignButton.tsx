import { useCallback, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { safePostMessage } from "../utils/postMessage";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";

type Alignment = "left" | "center" | "right" | "justify";

const ALIGNMENT_CLASSES: Record<Alignment, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
  justify: "text-justify",
};

const ALIGN_ICONS: Record<Alignment, LucideIcon> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight,
  justify: AlignJustify,
};

const ALIGNMENTS: readonly Alignment[] = ["left", "center", "right", "justify"];

/** Returns the alignment class currently on the element, or null if none is set
 *  (the element is using its inherited / default alignment). Returning null on
 *  "no class" is intentional — defaulting to "left" would lie about state for
 *  RTL pages or for elements that inherit alignment from a parent. */
function getCurrentAlignment(el: HTMLElement | null): Alignment | null {
  if (!el) return null;
  const entry = (Object.entries(ALIGNMENT_CLASSES) as [Alignment, string][]).find(
    ([, cls]) => el.classList.contains(cls),
  );
  return entry?.[0] ?? null;
}

interface TextAlignButtonProps {
  selectedElement: HTMLElement | null;
}

/**
 * Hover-bar dropdown for setting `text-align` on a block-level text element.
 * Class-toggle pattern (no inline style); applies the chosen `text-{value}`
 * Tailwind class, persists via STYLE_UPDATED postMessage, and rolls back on
 * STYLE_EDIT_FAILED.
 *
 * Parent (`ElementHoverBar`) is responsible for gating to block-level tags —
 * `text-align` has no effect on inline elements like span/a/label.
 */
export default function TextAlignButton({ selectedElement }: TextAlignButtonProps) {
  const [showMenu, setShowMenu] = useState(false);
  // Used to re-render after we mutate classList directly so the icon and
  // active state reflect the new alignment without waiting on the parent.
  const [, forceRender] = useState(0);

  const currentAlignment = getCurrentAlignment(selectedElement);
  const CurrentIcon = currentAlignment ? ALIGN_ICONS[currentAlignment] : AlignLeft;

  const handleSetAlignment = useCallback((next: Alignment | null) => {
    const el = selectedElement;
    if (!el) return;

    const originalClassName = el.className;

    // Optimistic DOM update: remove any existing alignment class, then add the new one.
    for (const cls of Object.values(ALIGNMENT_CLASSES)) el.classList.remove(cls);
    if (next) el.classList.add(ALIGNMENT_CLASSES[next]);
    forceRender(n => n + 1);
    setShowMenu(false);

    const commitId = addStyleEditListener((event) => {
      if (event.data.type === StyleMessageEventType.EDIT_FAILED) {
        el.className = originalClassName;
        forceRender(n => n + 1);
      }
    });

    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const elRect = el.getBoundingClientRect();

    safePostMessage(window.parent, {
      type: StyleMessageEventType.UPDATED,
      data: {
        commitId,
        selector: preciseSelector,
        property: "textAlign",
        value: next ?? "",
        newClassName: el.className,
        elementInfo: {
          tagName: el.tagName.toLowerCase(),
          className: getElementClassName(el),
          id: el.id,
          dataId: devContext?.devId || "",
          textContent: (el.textContent || "").substring(0, 500),
          selector: preciseSelector,
          devContext,
          rect: { top: elRect.top, left: elRect.left, width: elRect.width, height: elRect.height },
          computedStyles: {},
        },
      },
    });
  }, [selectedElement]);

  return (
    <div style={{ position: "relative" }}>
      <HoverBarButton
        onClick={() => setShowMenu(open => !open)}
        title={t("devtools_text_align_title", "Text alignment")}
        icon={<CurrentIcon width={15} height={15} />}
        active={showMenu || !!currentAlignment}
      />
      {showMenu && (
        <div
          data-airo-dev-tools=""
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 100002,
            display: "flex",
            gap: "2px",
            padding: "4px",
            background: "white",
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: "6px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          {ALIGNMENTS.map(a => {
            const Icon = ALIGN_ICONS[a];
            return (
              <HoverBarButton
                key={a}
                onClick={() => handleSetAlignment(currentAlignment === a ? null : a)}
                title={t(`devtools_align_${a}_title`, `Align ${a}`)}
                icon={<Icon width={15} height={15} />}
                active={currentAlignment === a}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
