/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { postInitialBuildEvent } from "../completionSideEffects";

const { mockAppFetch, mockLogger, mockSafeGetItem, mockSafeSetItem } = vi.hoisted(() => ({
  mockAppFetch: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockSafeGetItem: vi.fn(),
  mockSafeSetItem: vi.fn(),
}));

vi.mock("@/lib/gasket-config", () => ({
  appFetch: mockAppFetch,
}));

vi.mock("@/lib/request-context", () => ({
  logger: mockLogger,
}));

vi.mock("@/utils/localStorage", () => ({
  safeGetItem: mockSafeGetItem,
  safeSetItem: mockSafeSetItem,
}));

describe("completionSideEffects", () => {
  describe("postInitialBuildEvent", () => {
    const APP_ID = "app-123";
    const STORAGE_KEY = `airo_initial_build_event_sent_${APP_ID}`;
    const MOCK_UUID = "550e8400-e29b-41d4-a716-446655440000";

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(MOCK_UUID);
      mockSafeGetItem.mockReturnValue(null);
      mockAppFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    });

    describe("first call", () => {
      it("should call appFetch with the correct URL", () => {
        postInitialBuildEvent(APP_ID);

        expect(mockAppFetch).toHaveBeenCalledWith(
          `/api/apps/${APP_ID}/events`,
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      it("should POST with the correct eventType and idempotencyKey in the payload", () => {
        postInitialBuildEvent(APP_ID);

        const [, options] = mockAppFetch.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(options.body as string);

        expect(body.eventType).toBe("build.initial_build_completed");
        expect(body.idempotencyKey).toBe(MOCK_UUID);
        expect(body.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('should call safeSetItem with "true" after a successful response', async () => {
        postInitialBuildEvent(APP_ID);

        await vi.waitFor(() => {
          expect(mockSafeSetItem).toHaveBeenCalledWith(STORAGE_KEY, "true");
        });
      });
    });

    describe("idempotency guard", () => {
      it('should not call appFetch when safeGetItem returns "true"', () => {
        mockSafeGetItem.mockReturnValue("true");

        postInitialBuildEvent(APP_ID);

        expect(mockAppFetch).not.toHaveBeenCalled();
      });

      it("should not call appFetch on a second call for the same appId", async () => {
        postInitialBuildEvent(APP_ID);
        await vi.waitFor(() => expect(mockSafeSetItem).toHaveBeenCalled());
        mockAppFetch.mockClear();
        mockSafeGetItem.mockReturnValue("true");

        postInitialBuildEvent(APP_ID);

        expect(mockAppFetch).not.toHaveBeenCalled();
      });

      it("should fire for a different appId even when the first has already been sent", () => {
        mockSafeGetItem.mockImplementation((key: string) =>
          key === STORAGE_KEY ? "true" : null,
        );
        const otherAppId = "app-999";

        postInitialBuildEvent(otherAppId);

        expect(mockAppFetch).toHaveBeenCalledWith(
          `/api/apps/${otherAppId}/events`,
          expect.anything(),
        );
      });
    });

    describe("error handling", () => {
      it("should log a warning and not throw when appFetch rejects", async () => {
        mockAppFetch.mockRejectedValue(new Error("Network timeout"));

        postInitialBuildEvent(APP_ID);

        await vi.waitFor(() => {
          expect(mockLogger.warn).toHaveBeenCalledWith(
            "completionSideEffects.initial-build-event.failed",
            { appId: APP_ID, error: "Network timeout" },
          );
        });
      });

      it("should not call safeSetItem when appFetch rejects", async () => {
        mockAppFetch.mockRejectedValue(new Error("fail"));

        postInitialBuildEvent(APP_ID);

        await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalled());
        expect(mockSafeSetItem).not.toHaveBeenCalled();
      });

      it("should use String(error) when a non-Error value is thrown", async () => {
        mockAppFetch.mockRejectedValue("plain string error");

        postInitialBuildEvent(APP_ID);

        await vi.waitFor(() => {
          expect(mockLogger.warn).toHaveBeenCalledWith(
            "completionSideEffects.initial-build-event.failed",
            { appId: APP_ID, error: "plain string error" },
          );
        });
      });

      it("should not call safeSetItem when server returns a non-ok response", async () => {
        mockAppFetch.mockResolvedValue(new Response("{}", { status: 500 }));

        postInitialBuildEvent(APP_ID);

        await vi.waitFor(() => {
          expect(mockLogger.warn).toHaveBeenCalledWith(
            "completionSideEffects.initial-build-event.http-error",
            { appId: APP_ID, status: 500 },
          );
        });
        expect(mockSafeSetItem).not.toHaveBeenCalled();
      });
    });

    describe("SSR guard", () => {
      it("should return early without calling appFetch when window is undefined", () => {
        vi.stubGlobal("window", undefined);

        postInitialBuildEvent(APP_ID);

        expect(mockAppFetch).not.toHaveBeenCalled();

        vi.unstubAllGlobals();
      });
    });
  });
});
