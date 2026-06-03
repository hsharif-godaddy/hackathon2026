import { useCallback, useEffect, useRef, useState } from "react";
import { ALargeSmall, Minus, Plus } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import { addStyleEditListener, StyleMessageEventType } from "../utils/elementStyleListeners";
import { extractDevContext, generatePreciseSelector, getElementClassName } from "../utils/element-helpers";
import {
  nextSize,
  nearestSizeClass,
  type SizeClass,
} from "../utils/text-size";
import { send, trackEventBus } from "../utils/eventBus";

interface TextSizeStepperButtonProps {
  selectedElement: HTMLElement | null;
  /** Controlled popover state — parent (`ElementHoverBar`) coordinates so
   *  Color Picker / Size Stepper / Text Align never stack on top of each other. */
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Hover-bar text-size control. Trigger button shows a Type icon; clicking it
 * opens a small popover with − / + steppers that walk Tailwind's size scale.
 * Mutex within the size group; preserves text-{color} and text-{align}.
 * Backend handler: `fontSize` case in ast-style-editor.ts.
 */
export default function TextSizeStepperButton({ selectedElement, isOpen, onOpenChange }: TextSizeStepperButtonProps) {
  const [, forceRender] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Use the COMPUTED font-size as the source of truth for "current size."
  // classList scanning misses three real cases this component hits:
  //   1. Responsive variants winning at the current breakpoint
  //      (`text-6xl md:text-8xl` renders text-8xl on desktop)
  //   2. Theme overrides that change the rem-to-class mapping
  //   3. Inherited font-size from a parent or inline `style="font-size: ..."`
  // The element's getComputedStyle.fontSize reflects what the user actually
  // sees in all three cases. We map it back onto the closest scale entry.
  //
  // Note: inline `style="font-size: ..."` is handled by the AST now —
  // applyInlineStyle strips the fontSize key from the JSX `style` object
  // when an editable shape is present, otherwise the AST returns
  // INLINE_STYLE_NOT_EDITABLE and our optimistic update rolls back.
  const effective: SizeClass = selectedElement
    ? nearestSizeClass(parseFloat(window.getComputedStyle(selectedElement).fontSize) || 16)
    : "text-base";
  const stepUpTarget = nextSize(effective, "up", { tagName: selectedElement?.tagName });
  const stepDownTarget = nextSize(effective, "down", { tagName: selectedElement?.tagName });
  const atMax = stepUpTarget === null;
  const atMin = stepDownTarget === null;

  // Close popover on outside click. Match TextAlignButton's dismissal model:
  // stay open across stepper clicks, dismiss on click outside.
  useEffect(() => {
    if (!isOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && containerRef.current.contains(target)) return;
      onOpenChange(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  const applySize = useCallback(
    (next: SizeClass) => {
      if (!selectedElement) return;

      const originalClassName = selectedElement.className;

      // Mirror the AST-side strip so the optimistic DOM state matches what
      // the file edit will produce: drop base + responsive-variant size
      // classes AND arbitrary text-[<length>] classes. Without this, an
      // element with `md:text-3xl text-3xl` would briefly keep the variant
      // class winning the cascade until Vite HMR caught up.
      //
      // Variants are peeled imperatively (not via nested `(?:...:)*`) so
      // Semgrep's ReDoS detector doesn't flag the patterns.
      const peelVariantPrefixes = (cls: string): string => {
        let bare = cls;
        while (true) {
          // Match agents/ side: trailing `i` flag is a no-op on lowercase
          // input but keeps both copies textually identical for the drift
          // guard test (and matches the security-scan exception list).
          const match = /^[a-z0-9-]+:/i.exec(bare);
          if (!match) return bare;
          bare = bare.slice(match[0].length);
        }
      };
      // BARE_SIZE / BARE_ARBITRARY / LENGTH_SHAPE — keep in sync with the
      // copies in agents/src/tools/ast-style-editor.ts (no shared package
      // between agents/ and dev-tools/, so duplicated rather than imported).
      // A drift-detection test in agents/src/tools/__tests__ reads both
      // source files and fails if these literals diverge.
      const BARE_SIZE = /^text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/;
      const BARE_ARBITRARY = /^text-\[([^\]]+)\]$/;
      const LENGTH_SHAPE = /\d(?:\.\d+)?\s*(?:px|rem|em|vw|vh|%|ch|ex|cm|mm|in|pt|pc)\b|\b(?:clamp|calc|min|max)\s*\(/i;
      for (const cls of Array.from(selectedElement.classList)) {
        const bare = peelVariantPrefixes(cls);
        if (BARE_SIZE.test(bare)) {
          selectedElement.classList.remove(cls);
          continue;
        }
        const arb = bare.match(BARE_ARBITRARY);
        if (arb && LENGTH_SHAPE.test(arb[1] ?? "")) {
          selectedElement.classList.remove(cls);
        }
      }
      selectedElement.classList.add(next);
      forceRender((n) => n + 1);

      const commitId = addStyleEditListener((event: MessageEvent) => {
        if (event.data.type === StyleMessageEventType.EDIT_FAILED) {
          selectedElement.className = originalClassName;
          forceRender((n) => n + 1);
        }
      });

      const devContext = extractDevContext(selectedElement);
      const preciseSelector = generatePreciseSelector(selectedElement);

      send({
        type: StyleMessageEventType.UPDATED,
        data: {
          commitId,
          selector: preciseSelector,
          property: "fontSize",
          value: next,
          newClassName: selectedElement.className,
          elementInfo: {
            tagName: selectedElement.tagName.toLowerCase(),
            className: getElementClassName(selectedElement),
            id: selectedElement.id,
            dataId: devContext?.devId || "",
            textContent: (selectedElement.textContent || "").substring(0, 500),
            selector: preciseSelector,
            devContext,
            rect: selectedElement.getBoundingClientRect(),
            computedStyles: {},
          },
        },
      });
    },
    [selectedElement],
  );

  const handleDecrement = useCallback(() => {
    if (!stepDownTarget) return;
    trackEventBus.click("devtools.toolbar.text_size_down");
    applySize(stepDownTarget);
  }, [applySize, stepDownTarget]);

  const handleIncrement = useCallback(() => {
    if (!stepUpTarget) return;
    trackEventBus.click("devtools.toolbar.text_size_up");
    applySize(stepUpTarget);
  }, [applySize, stepUpTarget]);

  return (
    <div ref={containerRef} className="relative flex items-stretch">
      <HoverBarButton
        onClick={() => onOpenChange(!isOpen)}
        title={t("devtools_text_size_title", "Text size")}
        suppressTooltip={isOpen}
        icon={<ALargeSmall width={15} height={15} />}
        active={isOpen}
      />
      {isOpen && (
        <div
          data-airo-dev-tools=""
          className="flex gap-1 p-1 rounded-xl absolute bg-white"
          style={{
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 100002,
            border: "1px solid rgba(0,0,0,0.1)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <HoverBarButton
            onClick={handleDecrement}
            title={t("devtools_text_size_decrement_title", "Decrease text size")}
            icon={<Minus width={15} height={15} />}
            disabled={atMin}
          />
          <HoverBarButton
            onClick={handleIncrement}
            title={t("devtools_text_size_increment_title", "Increase text size")}
            icon={<Plus width={15} height={15} />}
            disabled={atMax}
          />
        </div>
      )}
    </div>
  );
}
