/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// ── Mocks (must be declared before importing the hook) ──

vi.mock("../../utils/postMessage", () => ({
  isOriginAllowed: () => true,
  safePostMessage: vi.fn(),
}));

const sendSpy = vi.fn();
vi.mock("../../utils/eventBus", () => ({
  send: (...args: unknown[]) => sendSpy(...args),
  TextEditErrorCode: {},
}));

vi.mock("../../utils/inline-edit-tracking", () => ({
  trackInlineEdit: vi.fn(),
}));

vi.mock("../../utils/translations", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

vi.mock("../../utils/element-helpers", () => ({
  generatePreciseSelector: () => "p.test",
  extractDevContext: () => ({}),
}));

vi.mock("../../utils/element-detection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/element-detection")>();
  return {
    ...actual,
    isDevToolsElement: () => false,
    generateSelector: () => "p",
    isBodyTextElement: () => false,
    resolveContentKey: () => null,
    // resolveConformTarget is a spy; tests can override it per-call
    resolveConformTarget: vi.fn(() => null),
    isInsideNavSurface: () => false,
  };
});

vi.mock("../../utils/content-edit-payload", () => ({
  buildContentUpdatePayload: () => ({}),
}));

vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: vi.fn(), unmount: vi.fn() }),
}));

vi.mock("../../components/InlineLexicalEditor", () => ({
  default: () => null,
}));

// Key mock: waitForContentBacked is replaced with a spy that captures each
// returned cancel. We store it on globalThis to avoid vitest hoisting TDZ.
vi.mock("../../utils/text-editing-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/text-editing-helpers")>();
  return {
    ...actual,
    waitForContentBacked: vi.fn(
      (_selector: string, _cb: (el: HTMLElement) => void, _timeout: number): (() => void) => {
        const cancel: () => void = vi.fn();
        (globalThis as Record<string, unknown>).__testLastCancelFn = cancel;
        return cancel;
      },
    ),
  };
});

import { useTextEditing } from "../useTextEditing";

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  sendSpy.mockClear();
  document.body.replaceChildren();
  delete (globalThis as Record<string, unknown>).__testLastCancelFn;
});

afterEach(() => {
  cleanup();
});

describe("useTextEditing — deactivation cancels in-flight conform wait", () => {
  it("test 6: when isEditModeActive flips false, any stored conformWaitCancel is called", async () => {
    vi.useFakeTimers();

    // Capture the document click handler so we can invoke it with a synthetic
    // trusted-looking event (isTrusted cannot be set on a real MouseEvent in jsdom)
    const capturedHandlers: Array<(e: MouseEvent) => void> = [];
    const origAdd = document.addEventListener.bind(document);
    const addSpy = vi.spyOn(document, "addEventListener").mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void => {
        if (type === "click") {
          capturedHandlers.push(listener as (e: MouseEvent) => void);
        }
        origAdd(type, listener, options);
      },
    );

    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useTextEditing(active, true),
      { initialProps: { active: true } },
    );

    addSpy.mockRestore();

    expect(capturedHandlers.length).toBeGreaterThan(0);
    const clickHandler: (e: MouseEvent) => void = capturedHandlers[capturedHandlers.length - 1];

    // Set up a conformable-array target element
    const conformHost: HTMLElement = document.createElement("div");
    conformHost.setAttribute("data-dev-conformable-array", "items");
    conformHost.setAttribute("data-dev-conformable-page", "src/pages/index.tsx");
    const target: HTMLElement = document.createElement("p");
    target.textContent = "Item text";
    conformHost.appendChild(target);
    document.body.appendChild(conformHost);

    // Override resolveConformTarget for this click
    const { resolveConformTarget } = await import("../../utils/element-detection");
    const conformTargetMock = resolveConformTarget as ReturnType<typeof vi.fn>;
    conformTargetMock.mockReturnValueOnce({ page: "src/pages/index.tsx", arrayName: "items" });

    // Invoke the click handler directly with a synthetic event carrying isTrusted=true
    act(() => {
      const syntheticEvent = {
        isTrusted: true,
        target,
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent;
      clickHandler(syntheticEvent);
    });

    // Extract the requestId that the click handler sent with CONFORM_REQUEST
    const conformRequestCall = sendSpy.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "CONFORM_REQUEST",
    );
    const sentRequestId: string | undefined = (conformRequestCall?.[0] as { requestId?: string })?.requestId;
    expect(sentRequestId).toBeDefined();

    // Send CONFORM_SUCCEEDED with the matching requestId — should call waitForContentBacked
    act(() => {
      const msg: MessageEvent = new MessageEvent("message", {
        data: { type: "CONFORM_SUCCEEDED", requestId: sentRequestId },
        origin: window.location.origin,
      });
      window.dispatchEvent(msg);
    });

    const capturedCancel = (globalThis as Record<string, unknown>).__testLastCancelFn as
      | ReturnType<typeof vi.fn>
      | undefined;

    expect(capturedCancel).toBeDefined();
    expect(capturedCancel).not.toHaveBeenCalled();

    // Flip edit mode off — the deactivation effect should invoke the cancel
    rerender({ active: false });

    expect(capturedCancel).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
