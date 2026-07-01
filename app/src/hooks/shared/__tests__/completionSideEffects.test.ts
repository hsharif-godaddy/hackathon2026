/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleCommitComplete, postInitialBuildEvent, trackToolResult } from "../completionSideEffects";

const { mockLogImpressionEvent, mockSendToolImpressionEvent } = vi.hoisted(() => ({
  mockLogImpressionEvent: vi.fn(() => vi.fn()),
  mockSendToolImpressionEvent: vi.fn(),
}));

const {
  mockGetQueryClient,
  mockInvalidateQueries,
  mockSetSelectedCommitHash,
  mockClearRedoStack,
  mockSetUndoCursor,
  mockGetStreamingState,
} = vi.hoisted(() => ({
  mockGetQueryClient: vi.fn(),
  mockInvalidateQueries: vi.fn(),
  mockSetSelectedCommitHash: vi.fn(),
  mockClearRedoStack: vi.fn(),
  mockSetUndoCursor: vi.fn(),
  mockGetStreamingState: vi.fn(),
}));

vi.mock("@/components/providers/QueryClientProvider", () => ({
  getQueryClient: mockGetQueryClient,
}));

vi.mock("@/stores/useGitStore", () => ({
  useGitStore: {
    getState: () => ({
      setSelectedCommitHash: mockSetSelectedCommitHash,
      clearRedoStack: mockClearRedoStack,
      setUndoCursor: mockSetUndoCursor,
    }),
  },
}));

vi.mock("@/stores/useStreamingConversationStore", () => ({
  useStreamingConversationStore: {
    getState: mockGetStreamingState,
  },
}));

vi.mock("@/utils/instrumentation", () => ({
  logImpressionEvent: mockLogImpressionEvent,
}));

vi.mock("@/hooks/chat/useChatHelpers", () => ({
  sendToolImpressionEvent: mockSendToolImpressionEvent,
}));

const { mockAppFetch, mockLogger, mockSafeGetItem, mockSafeSetItem, mockSetState } = vi.hoisted(() => ({
  mockAppFetch: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockSafeGetItem: vi.fn(),
  mockSafeSetItem: vi.fn(),
  mockSetState: vi.fn(),
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

vi.mock("@/stores/useDevelopPageStore", () => ({
  useDevelopPageStore: {
    setState: mockSetState,
  },
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
        mockSafeGetItem.mockImplementation(function (key: string) { return key === STORAGE_KEY ? "true" : null; },
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

    describe("store update", () => {
      beforeEach(() => {
        mockSetState.mockReset();
        mockSafeGetItem.mockReturnValue(null);
        mockSafeSetItem.mockReset();
      });

      it("updates useDevelopPageStore.app.initialBuildComplete when first build fires", () => {
        postInitialBuildEvent(APP_ID);
        expect(mockSetState).toHaveBeenCalledOnce();
        const updater = mockSetState.mock.calls[0][0];
        const result = updater({ app: { initialBuildComplete: false, id: APP_ID } });
        expect(result.app.initialBuildComplete).toBe(true);
      });

      it("does not update store when already fired (localStorage guard)", () => {
        mockSafeGetItem.mockReturnValue("true");
        postInitialBuildEvent(APP_ID);
        expect(mockSetState).not.toHaveBeenCalled();
      });

      it("leaves app null alone", () => {
        postInitialBuildEvent(APP_ID);
        const updater = mockSetState.mock.calls[0][0];
        const result = updater({ app: null });
        expect(result.app).toBeNull();
      });
    });
  });

  describe("trackToolResult", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("fires develop.tool.skill for a skill load with action + skill name", () => {
      trackToolResult({ name: "skill", input: { action: "load", skill: "blog" } });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill", {
        action: "load",
        skillName: "blog",
      });
      expect(mockSendToolImpressionEvent).not.toHaveBeenCalled();
    });

    it("still fires develop.tool.skill for a list action (count preserved), with the action prop", () => {
      trackToolResult({ name: "skill", input: { action: "list" } });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill", { action: "list" });
    });

    it("still fires develop.tool.skill for an install action, enriched with action + skill name", () => {
      trackToolResult({ name: "skill", input: { action: "install", skill: "blog" } });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill", {
        action: "install",
        skillName: "blog",
      });
    });

    it("fires develop.tool.skill even when input is absent (count preserved)", () => {
      trackToolResult({ name: "skill" });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill", {});
    });

    it("includes path in props for a loadReference action", () => {
      trackToolResult({ name: "skill", input: { action: "loadReference", path: "online-appointments/sections/01-discovery-questions" } });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill", {
        action: "loadReference",
        path: "online-appointments/sections/01-discovery-questions",
      });
    });

    it("fires develop.tool.skill_tool AND the legacy per-name impression for a per-skill tool", () => {
      trackToolResult({ name: "commerce__commerce_store_list", skillName: "commerce" });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill_tool", {
        skillName: "commerce",
        toolName: "commerce_store_list",
      });
      // Migration shim: legacy per-name impression still emitted for back-compat.
      expect(mockSendToolImpressionEvent).toHaveBeenCalledWith("commerce__commerce_store_list");
    });

    it("falls back to the raw name when the prefix does not match the skillName", () => {
      trackToolResult({ name: "unprefixed", skillName: "commerce" });

      expect(mockLogImpressionEvent).toHaveBeenCalledWith("develop.tool.skill_tool", {
        skillName: "commerce",
        toolName: "unprefixed",
      });
    });

    it("fires the generic per-name impression for a normal tool", () => {
      trackToolResult({ name: "readfile" });

      expect(mockSendToolImpressionEvent).toHaveBeenCalledWith("readfile");
      expect(mockLogImpressionEvent).not.toHaveBeenCalled();
    });
  });

  describe("handleCommitComplete", () => {
    const APP_ID = "app-123";
    const COMMIT = "abcdef123456";

    beforeEach(() => {
      vi.clearAllMocks();
      mockInvalidateQueries.mockResolvedValue(undefined);
      mockGetQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries });
      mockGetStreamingState.mockReturnValue({ streamingState: "idle", activeStream: null });
      vi.spyOn(window, "postMessage").mockImplementation(() => {});
    });

    it("invalidates git-history and secretsDiff caches", async () => {
      await handleCommitComplete(COMMIT, APP_ID);

      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ["git-history", APP_ID],
        refetchType: "active",
      });
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: ["secretsDiff", APP_ID],
        refetchType: "active",
      });
    });

    it("updates the selected commit hash", async () => {
      await handleCommitComplete(COMMIT, APP_ID);

      expect(mockSetSelectedCommitHash).toHaveBeenCalledWith(APP_ID, COMMIT);
    });

    it("clears the redo stack and re-anchors the undo cursor on a new agent commit", async () => {
      await handleCommitComplete(COMMIT, APP_ID);

      expect(mockClearRedoStack).toHaveBeenCalledWith(APP_ID);
      expect(mockSetUndoCursor).toHaveBeenCalledWith(APP_ID, COMMIT);
    });
  });
});
