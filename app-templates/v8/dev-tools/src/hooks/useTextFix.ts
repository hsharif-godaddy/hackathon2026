import { useCallback, useEffect, useRef, useState } from "react";
import { send } from "../utils/eventBus";
import { extractDevContext, generatePreciseSelector } from "../utils/element-helpers";
import { mergeOriginalClasses } from "../utils/text-editing-helpers";
import { htmlToJsxStructured } from "../utils/html-to-jsx";
import { isCommerceManagedContent } from "../utils/commerce-managed-content";
import {
  type FixState,
  htmlStringToDisplayText,
  isWhitespaceOnlyChange,
  makeFixRequestId,
  wrapInnerHtml,
} from "../utils/text-fix-helpers";

const FIX_REPLY_TIMEOUT_MS = 30_000;
const TRANSIENT_STATE_RESET_MS = 2000;

interface UseTextFixResult {
  state: FixState;
  /** Send the proofread request for the given element. No-ops when the
   *  element has no trimmed text content. */
  request: (el: HTMLElement) => void;
  /** Commit the previewed correction through the standard TEXT_UPDATED → AST
   *  text-edit pipeline. No-op when not in preview state. */
  accept: (el: HTMLElement) => void;
  /** Discard the previewed correction and return to idle. */
  reject: () => void;
  /** Cancel any in-flight request and return to idle. Used by parent cleanup
   *  paths (toolbar dismiss, element change, click-outside). */
  reset: () => void;
}

/**
 * Owns the lifecycle of the inline Fix (proofread) flow:
 *   idle → request() → loading → message reply → preview | no-change | error
 *   preview → accept() → idle (and emits TEXT_UPDATED)
 *   preview → reject() → idle
 *
 * The hook only manages its own state and the in-flight message listener.
 * Callers are responsible for calling `reset()` on dismiss paths (element
 * change, click-outside, toolbar close) — same shape as the original inline
 * implementation, so the parent's existing cleanup branches stay coherent.
 */
export function useTextFix(): UseTextFixResult {
  const [state, setState] = useState<FixState>({ status: "idle" });
  const requestRef = useRef<{ requestId: string; cleanup: () => void } | null>(null);

  const cancelPending = useCallback(() => {
    if (requestRef.current) {
      requestRef.current.cleanup();
      requestRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancelPending();
    setState({ status: "idle" });
  }, [cancelPending]);

  // Cancel any pending request on unmount so a late reply doesn't fire
  // setState on a torn-down component.
  useEffect(() => {
    return () => cancelPending();
  }, [cancelPending]);

  const request = useCallback((el: HTMLElement) => {
    if (isCommerceManagedContent(el)) return;

    // We send the element's innerHTML to the proofreader so it has the full
    // structural picture — text + `<br>` + `<span>`/`<strong>`/`<a>` etc. The
    // agent prompt instructs strict tag/attribute preservation; only text
    // content gets corrected.
    const oldHtml = el.innerHTML;
    if (!(el.textContent || "").trim()) return;

    cancelPending();

    const requestId = makeFixRequestId();
    setState({ status: "loading" });

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const handleResult = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const type = e.data?.type;
      if (type !== "TEXT_FIX_RESULT" && type !== "TEXT_FIX_FAILED") return;
      if (e.data?.requestId !== requestId) return;
      cleanup();
      if (type === "TEXT_FIX_RESULT") {
        const data = e.data?.data as { newText?: string; changed?: boolean } | undefined;
        const newHtml = typeof data?.newText === "string" ? data.newText : oldHtml;
        // Treat whitespace-only "corrections" (e.g. `"foo  bar"` →
        // `"foo bar"`) as no-change — the diff would render as visually
        // identical and confuse the user. `isWhitespaceOnlyChange` compares
        // the display text with all whitespace runs collapsed.
        if (!data?.changed || isWhitespaceOnlyChange(oldHtml, newHtml)) {
          setState({ status: "no-change" });
          setTimeout(
            () => setState((s) => (s.status === "no-change" ? { status: "idle" } : s)),
            TRANSIENT_STATE_RESET_MS,
          );
        } else {
          setState({ status: "preview", oldHtml, newHtml });
        }
      } else {
        setState({ status: "error" });
        setTimeout(
          () => setState((s) => (s.status === "error" ? { status: "idle" } : s)),
          TRANSIENT_STATE_RESET_MS,
        );
      }
    };
    const cleanup = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      window.removeEventListener("message", handleResult);
      if (requestRef.current?.requestId === requestId) {
        requestRef.current = null;
      }
    };

    window.addEventListener("message", handleResult);
    timeoutId = setTimeout(() => {
      cleanup();
      setState({ status: "error" });
      setTimeout(
        () => setState((s) => (s.status === "error" ? { status: "idle" } : s)),
        TRANSIENT_STATE_RESET_MS,
      );
      console.warn("[dev-tools] TEXT_FIX_REQUESTED reply timed out", { requestId });
    }, FIX_REPLY_TIMEOUT_MS);
    requestRef.current = { requestId, cleanup };

    // Field name is `oldText` for backward-compat with the route/agent
    // contract — its semantics widened from "plain text" to "inner HTML"
    // (the agent prompt was updated accordingly).
    send({
      type: "TEXT_FIX_REQUESTED",
      data: { requestId, oldText: oldHtml },
    });
  }, [cancelPending]);

  // Compute and side-effects (HTML→JSX, postMessage) happen OUTSIDE the
  // setState updater. React may invoke updaters twice in StrictMode and
  // bails out the state transition if an updater throws — running the
  // compute inline would double-fire postMessage on dev and leave the
  // popover stuck in `preview` if any helper threw. State is read via
  // dep-tracked reference so the callback identity changes per render
  // (callers re-grab from `useTextFix()` each render anyway).
  const accept = useCallback((el: HTMLElement) => {
    if (state.status !== "preview") return;
    if (isCommerceManagedContent(el)) {
      setState({ status: "idle" });
      return;
    }

    const { oldHtml, newHtml } = state;
    const devContext = extractDevContext(el);
    const preciseSelector = generatePreciseSelector(el);
    const tag = el.tagName.toLowerCase();
    const classes = el.getAttribute("class") || "";

    // Always go through the `newHtml` path (same one useTextEditing uses
    // for mixed-content elements) regardless of whether the element has
    // inline children — uniform handling means one tested code path. For
    // pure-text elements the wrapped HTML is just <tag>text</tag>, which
    // still flows correctly through htmlToJsxStructured.
    const wrappedHtml = wrapInnerHtml(newHtml, tag, classes);
    const merged = mergeOriginalClasses(wrappedHtml, classes);
    const structured = htmlToJsxStructured(merged);
    const newPlainText = htmlStringToDisplayText(newHtml).replace(/\n/g, " ");

    // Telemetry: notify parent so the BFF can log acceptance rate. Sent
    // before TEXT_UPDATED so the event lands even if the AST commit fails.
    send({
      type: "TEXT_FIX_ACCEPTED",
      data: {
        oldLength: oldHtml.length,
        newLength: newHtml.length,
      },
    });

    send({
      type: "TEXT_UPDATED",
      data: {
        selector: preciseSelector,
        preciseSelector,
        oldText: el.textContent || "",
        newText: newPlainText,
        newHtml: structured.childrenJsx,
        devContext,
      },
    });

    setState({ status: "idle" });
  }, [state]);

  const reject = useCallback(() => {
    if (state.status === "preview") {
      send({
        type: "TEXT_FIX_REJECTED",
        data: {
          oldLength: state.oldHtml.length,
          newLength: state.newHtml.length,
        },
      });
    }
    setState({ status: "idle" });
  }, [state]);

  return { state, request, accept, reject, reset };
}
