/* global MessageEvent */
import { addCorrelatedEditListener } from "./correlatedEditListener";

export enum FormatOverrideMessageEventType {
  UPDATED = "FORMAT_OVERRIDE_UPDATED",
  EDIT_SUCCEEDED = "FORMAT_OVERRIDE_EDIT_SUCCEEDED",
  EDIT_FAILED = "FORMAT_OVERRIDE_EDIT_FAILED",
}

export const FORMAT_OVERRIDE_REPLY_TIMEOUT_MS = 30_000;

export interface FormatOverrideTarget {
  file: string;
  tagName: string;
  sourceKind: "bound-expression" | "content-key" | "content-key-template";
  contentKey: string | null;
  contentKeyTemplate: string | null;
  expressionHash: string | null;
}

export interface FormatOverrideMessageTarget {
  devId: string;
  target: FormatOverrideTarget;
}

export interface FormatOverrideMarks {
  bold?: boolean;
  italic?: boolean;
  color?: string | null;
}

function normalizeFileName(raw: string): string {
  const normalized = raw.replace(/\\/g, "/");
  const srcIdx = normalized.indexOf("/src/");
  return srcIdx === -1 ? normalized : normalized.slice(srcIdx + 1);
}

function isFormatOverrideRuntimeComponent(file: string): boolean {
  return file === "src/components/FormattedBoundText.tsx";
}

export function isLoopRenderedElement(element: HTMLElement): boolean {
  const devId = element.getAttribute("data-dev-id");
  const devLine = element.getAttribute("data-dev-line");
  if (!devId || !devLine) return false;
  return document.querySelectorAll(`[data-dev-id="${devId}"][data-dev-line="${devLine}"]`).length > 1;
}

export function findFormatOverrideElement(element: HTMLElement): HTMLElement | null {
  const targetElement = element.closest('[data-dev-bound-text="true"]') as HTMLElement | null;
  if (!targetElement) return null;
  if (isLoopRenderedElement(targetElement)) return null;

  const file = targetElement.getAttribute("data-dev-file");
  if (!file) return null;

  const normalizedFile = normalizeFileName(file);
  if (isFormatOverrideRuntimeComponent(normalizedFile)) return null;

  return targetElement;
}

export function readFormatOverrideTarget(element: HTMLElement): FormatOverrideMessageTarget | null {
  const targetElement = findFormatOverrideElement(element);
  if (!targetElement) return null;

  const devId = targetElement.getAttribute("data-dev-id");
  const file = targetElement.getAttribute("data-dev-file");
  const sourceKind = targetElement.getAttribute("data-dev-bound-source-kind");
  const tagName = targetElement.tagName.toLowerCase();

  if (!devId || !file) return null;
  const normalizedFile = normalizeFileName(file);

  if (sourceKind !== "bound-expression" && sourceKind !== "content-key" && sourceKind !== "content-key-template") {
    return null;
  }

  const contentKey = targetElement.getAttribute("data-dev-content-key");
  const contentKeyTemplate = targetElement.getAttribute("data-dev-content-key-template");
  const expressionHash = targetElement.getAttribute("data-dev-bound-expression-hash");
  if (sourceKind === "bound-expression" && !expressionHash) return null;
  if (sourceKind === "content-key" && !contentKey) return null;
  if (sourceKind === "content-key-template" && !contentKeyTemplate) return null;

  return {
    devId,
    target: {
      file: normalizedFile,
      tagName,
      sourceKind,
      contentKey,
      contentKeyTemplate,
      expressionHash,
    },
  };
}

export function readCurrentFormatOverrideMarks(element: HTMLElement): Required<FormatOverrideMarks> {
  const targetElement = findFormatOverrideElement(element) ?? element;
  const formatted = targetElement.querySelector("[data-airo-formatted-bound-text]") as HTMLElement | null;
  return {
    bold: formatted?.getAttribute("data-airo-format-bold") === "true",
    italic: formatted?.getAttribute("data-airo-format-italic") === "true",
    color: formatted?.getAttribute("data-airo-format-color") || null,
  };
}

export function addFormatOverrideEditListener(
  handler: (event: MessageEvent) => void,
  onTimeout?: (event: { commitId: string }) => void,
): string {
  return addCorrelatedEditListener({
    successType: FormatOverrideMessageEventType.EDIT_SUCCEEDED,
    failureType: FormatOverrideMessageEventType.EDIT_FAILED,
    timeoutWarning: "[dev-tools] FORMAT_OVERRIDE_UPDATED reply timed out; listener detached",
    timeoutMs: FORMAT_OVERRIDE_REPLY_TIMEOUT_MS,
    handler,
    onTimeout,
  });
}
