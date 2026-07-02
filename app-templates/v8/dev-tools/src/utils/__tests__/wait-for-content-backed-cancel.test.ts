/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitForContentBacked } from "../text-editing-helpers";
import { handleConformReply, type PendingConform } from "../../hooks/useTextEditing";

vi.mock("../translations", () => ({
  t: (_key: string, fallback: string) => fallback,
}));

describe("waitForContentBacked — cancel handle", () => {
  beforeEach(() => {
    // Clean up any leftover DOM elements between tests
    document.body.replaceChildren();
  });

  it("test 1: calling cancel before the observer fires prevents the callback", () => {
    const cb = vi.fn();
    const el: HTMLElement = document.createElement("p");
    el.setAttribute("class", "target");
    el.textContent = "Hello";
    document.body.appendChild(el);

    const cancel: () => void = waitForContentBacked(".target", cb, 4000);
    cancel();

    // Now trigger the observer by adding the content-key attribute
    el.setAttribute("data-dev-content-key", "content.hero.text");

    // Wait a tick for the MutationObserver to fire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb).not.toHaveBeenCalled();
        resolve();
      }, 10);
    });
  });

  it("test 2: calling cancel after the callback already fired is a no-op (does not throw)", () => {
    const cb = vi.fn();
    const el: HTMLElement = document.createElement("p");
    el.setAttribute("class", "already-backed");
    el.setAttribute("data-dev-content-key", "content.hero.text");
    el.textContent = "Hello";
    document.body.appendChild(el);

    // Synchronous path fires immediately
    const cancel: () => void = waitForContentBacked(".already-backed", cb, 4000);
    expect(cb).toHaveBeenCalledTimes(1);

    // Should not throw
    expect(() => cancel()).not.toThrow();
  });

  it("test 3: calling cancel clears the timeout so the callback is never called", () => {
    vi.useFakeTimers();
    try {
      const cb = vi.fn();
      const el: HTMLElement = document.createElement("p");
      el.setAttribute("class", "timeout-target");
      el.textContent = "Hello";
      document.body.appendChild(el);

      const cancel: () => void = waitForContentBacked(".timeout-target", cb, 5000);
      cancel();

      // Advance past the timeout
      vi.advanceTimersByTime(6000);

      expect(cb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleConformReply — edit-mode guard", () => {
  it("test 4: CONFORM_SUCCEEDED with isEditModeActive=false does NOT call waitForContentBackedFn", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.test",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "abc123",
      },
    };

    handleConformReply("CONFORM_SUCCEEDED", "abc123", pendingConformRef, startEditing, waitSpy, false);

    expect(waitSpy).not.toHaveBeenCalled();
    expect(startEditing).not.toHaveBeenCalled();
  });

  it("test 5: CONFORM_FAILED clears the pendingConformRef", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.test",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "abc123",
      },
    };

    handleConformReply("CONFORM_FAILED", "abc123", pendingConformRef, startEditing, waitSpy, true);

    expect(pendingConformRef.current).toBeNull();
    expect(waitSpy).not.toHaveBeenCalled();
  });
});

describe("handleConformReply — requestId correlation", () => {
  it("test 6: CONFORM_SUCCEEDED with mismatched requestId is ignored (ref stays, startEditing not called)", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.b",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "req-B",
      },
    };

    // A's stale reply arrives with req-A, but pending is now req-B
    handleConformReply("CONFORM_SUCCEEDED", "req-A", pendingConformRef, startEditing, waitSpy, true);

    expect(pendingConformRef.current).not.toBeNull();
    expect(startEditing).not.toHaveBeenCalled();
    expect(waitSpy).not.toHaveBeenCalled();
  });

  it("test 7: CONFORM_SUCCEEDED with matching requestId calls waitForContentBackedFn", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.a",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "req-A",
      },
    };

    handleConformReply("CONFORM_SUCCEEDED", "req-A", pendingConformRef, startEditing, waitSpy, true);

    expect(pendingConformRef.current).toBeNull();
    expect(waitSpy).toHaveBeenCalledOnce();
  });

  it("test 8: CONFORM_FAILED with mismatched requestId does NOT null the ref", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.b",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "req-B",
      },
    };

    // A's stale failure arrives with req-A
    handleConformReply("CONFORM_FAILED", "req-A", pendingConformRef, startEditing, waitSpy, true);

    expect(pendingConformRef.current).not.toBeNull();
    expect(pendingConformRef.current?.requestId).toBe("req-B");
  });

  it("test 9: CONFORM_FAILED with matching requestId nulls the ref", () => {
    const waitSpy = vi.fn((): (() => void) => () => {});
    const startEditing = vi.fn();
    const pendingConformRef: { current: PendingConform | null } = {
      current: {
        selector: "p.a",
        page: "src/pages/index.tsx",
        arrayName: "items",
        requestId: "req-A",
      },
    };

    handleConformReply("CONFORM_FAILED", "req-A", pendingConformRef, startEditing, waitSpy, true);

    expect(pendingConformRef.current).toBeNull();
  });
});
