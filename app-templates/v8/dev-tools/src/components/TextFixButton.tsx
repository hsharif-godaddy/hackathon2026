import { useEffect } from "react";
import { Check, Loader2, SpellCheck, X } from "lucide-react";
import { HoverBarButton } from "./HoverBar";
import { t } from "../utils/translations";
import type { FixState } from "../utils/text-fix-helpers";

interface TextFixButtonProps {
  state: FixState;
  onFix: () => void;
}

/**
 * Inline "Fix typos & grammar" toolbar button. Pure presentational —
 * the request lifecycle and state machine live in `useTextFix`, and the
 * diff-confirm popover lives in `TextFixPopover`. Caller decides whether
 * to render this (via element-eligibility gating) and renders the popover
 * separately when `state.status === "preview"`.
 */
export default function TextFixButton({ state, onFix }: TextFixButtonProps) {
  // Inject the spinner keyframe used by the loading icon. Named distinctly
  // so it can't collide with a customer app's own `spin` animation.
  useEffect(() => {
    const id = "airo-dev-tools-fix-spin";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent =
        `@keyframes airoFixSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <HoverBarButton
      testId="text-fix-button"
      onClick={state.status === "loading" ? () => {} : onFix}
      title={
        state.status === "loading"
          ? t("devtools_text_fix_loading", "Checking…")
          : state.status === "no-change"
          ? t("devtools_text_fix_no_change", "Looks good!")
          : state.status === "error"
          ? t("devtools_text_fix_error", "Couldn't check text")
          : t("devtools_text_fix_title", "Fix typos & grammar")
      }
      icon={
        state.status === "loading"
          ? <Loader2 width={15} height={15} style={{ animation: "airoFixSpin 1s linear infinite" }} />
          : state.status === "no-change"
          ? <Check width={15} height={15} />
          : state.status === "error"
          ? <X width={15} height={15} />
          : <SpellCheck width={15} height={15} />
      }
      active={state.status === "no-change"}
    />
  );
}
