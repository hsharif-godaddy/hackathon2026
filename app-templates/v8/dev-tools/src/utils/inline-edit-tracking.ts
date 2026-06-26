import { trackEventBus } from "./eventBus";

type InlineEditAction = "field" | "save" | "cancel";
type ContentTarget = { key: string; kind: "copy" | "richText" };

/**
 * Emit an inline-edit funnel EID for a content-backed element. No-op for
 * non-content elements (target null) so JSX-literal edits aren't tracked here.
 * Forwarded to FullStory by the parent's registerTrackEventBus as
 * `appbuilder.devtools.inline_edit.<action>.click`.
 *
 * Best-effort: the underlying postMessage rethrows non-DataCloneError failures
 * (e.g. SecurityError on a misconfigured parent origin). This is called first
 * in the edit lifecycle handlers, so a throw would strand the user mid-edit —
 * swallow it. Telemetry must never break the flow it instruments.
 */
export function trackInlineEdit(action: InlineEditAction, target: ContentTarget | null): void {
  if (!target) return;
  try {
    trackEventBus.click(`devtools.inline_edit.${action}`, {
      contentKey: target.key,
      fieldType: target.kind,
    });
  } catch (err) {
    console.warn("[dev-tools] inline-edit tracking failed", action, err);
  }
}
