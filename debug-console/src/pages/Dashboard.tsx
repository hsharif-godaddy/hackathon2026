"use client";

import { useRouter, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

import AppDetailsPanel from "@/components/AppDetailsPanel";
import CarePanel from "@/components/CarePanel";
import ConversationsPanel, { type ConversationsSource } from "@/components/ConversationsPanel";
import type {
  MgmtAppDetails,
  MgmtCustomerApp,
  MgmtSubscriptionGrants,
} from "@/lib/mgmt-types";
import type { LlmSpendData } from "@/lib/spend-types";
import { formatTimestamp } from "@/lib/date-utils";
import { CUSTOMER_ID_RE, SHOPPER_ID_RE } from "@/lib/mgmt-helpers";
import LogsPanel, { type LogSource } from "@/components/LogsPanel";
import InvestigatePanel from "@/components/InvestigatePanel";
import UserMenu from "@/components/UserMenu";
const TIME_RANGES = [
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 6 hours", value: "6h" },
  { label: "Last 24 hours", value: "24h" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 14 days", value: "14d" },
] as const;

const VALID_TIME_RANGE_VALUES = TIME_RANGES.map(
  (r) => r.value,
) as readonly string[];

interface ErrorSummary {
  total: number;
  last24Hours: number;
  errorGroups: Array<{
    message: string;
    count: number;
    lastSeen?: string;
    event?: string;
  }>;
}

interface AppContext {
  appId: string;
  metadata: {
    lastActivity?: string;
    subscriptionId?: string;
  };
  errorSummary: ErrorSummary;
}

type TabId =
  | "details"
  | "summary"
  | "conversations"
  | "care"
  | "logs"
  | "investigate";

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [appId, setAppId] = useState("");
  const [submittedAppId, setSubmittedAppId] = useState("");
  const [submittedCustomerId, setSubmittedCustomerId] = useState("");
  const [customerApps, setCustomerApps] = useState<MgmtCustomerApp[]>([]);
  const [customerAppsLoading, setCustomerAppsLoading] = useState(false);
  const [customerAppsError, setCustomerAppsError] = useState<string | null>(
    null,
  );
  const [customerAppsRefresh, setCustomerAppsRefresh] = useState(0);
  const [timeRange, setTimeRange] = useState("24h");
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [sources, setSources] = useState<LogSource[]>([]);
  const [context, setContext] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<
    Record<
      string,
      Array<{
        timestamp: string;
        message: string;
        event?: string;
        service?: string;
        raw: Record<string, unknown>;
      }>
    >
  >({});
  const [llmSpend, setLlmSpend] = useState<LlmSpendData | null>(null);
  const [llmSpendLoading, setLlmSpendLoading] = useState(false);
  const [llmSpendError, setLlmSpendError] = useState<string | null>(null);
  // Subscription + grant identifiers lifted from AppDetailsPanel — needed to
  // drive the LLM spend fetch that powers the Subscription Details section.
  const [mgmtRawSubId, setMgmtRawSubId] = useState<string | null>(null);
  const [mgmtGrantUserIds, setMgmtGrantUserIds] = useState<string[]>([]);

  const [shopperId, setShopperId] = useState<string | null>(null);

  const [conversationsSource, setConversationsSource] = useState<ConversationsSource>("langfuse");

  const [refreshKeys, setRefreshKeys] = useState({
    details: 0,
    summary: 0,
    conversations: 0,
    care: 0,
    logs: 0,
    investigate: 0,
  });

  // Tabs are mounted lazily on first visit, then kept alive via display:none.
  // Avoids the cold-start fan-out that fired Logs ES queries, Conversations
  // (Langfuse + Agent), and Care all in parallel before the user clicked.
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(
    () => new Set<TabId>([activeTab]),
  );
  useEffect(() => {
    setVisitedTabs((prev) =>
      prev.has(activeTab) ? prev : new Set(prev).add(activeTab),
    );
  }, [activeTab]);

  // Support bundle download state
  const [bundleWindow, setBundleWindow] = useState("60");
  const [bundleDownloading, setBundleDownloading] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const bundleInFlight = React.useRef(false);

  const handleRefreshTab = useCallback((tabId: TabId) => {
    setRefreshKeys((prev) => ({ ...prev, [tabId]: prev[tabId] + 1 }));
  }, []);

  const handleDownloadBundle = useCallback(async () => {
    if (!submittedAppId || bundleInFlight.current) return;
    bundleInFlight.current = true;
    setBundleDownloading(true);
    setBundleError(null);
    try {
      const params = new URLSearchParams({
        appId: submittedAppId,
        windowMinutes: bundleWindow,
      });
      const res = await fetch(`/api/support-bundle?${params}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="([^"]+)"/);
      const safeId = submittedAppId.replace(/[^a-zA-Z0-9_-]/g, "_");
      a.download = match?.[1] || `support-bundle-${safeId}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBundleError(err instanceof Error ? err.message : "Download failed");
    } finally {
      bundleInFlight.current = false;
      setBundleDownloading(false);
    }
  }, [submittedAppId, bundleWindow]);

  // Initialize from URL params on mount only
  useEffect(() => {
    const urlAppId = searchParams?.get("appId");
    const urlCustomerId = searchParams?.get("customerId");
    const urlTab = searchParams?.get("tab");
    const urlTimeRange = searchParams?.get("timeRange");
    const urlSource = searchParams?.get("source");
    if (urlCustomerId) {
      setAppId(urlCustomerId);
      setSubmittedCustomerId(urlCustomerId);
      if (urlAppId) {
        setSubmittedAppId(urlAppId);
      }
    } else if (urlAppId) {
      setAppId(urlAppId);
      setSubmittedAppId(urlAppId);
    }
    // Migrate legacy tab IDs to the merged Conversations tab.
    if (urlTab === "conversation") {
      setActiveTab("conversations");
      setConversationsSource("langfuse");
    } else if (urlTab === "aiAgent") {
      setActiveTab("conversations");
      setConversationsSource("agent");
    } else if (
      urlTab &&
      ["details", "summary", "conversations", "care", "logs", "investigate"].includes(urlTab)
    ) {
      setActiveTab(urlTab as TabId);
      if (
        urlTab === "conversations" &&
        (urlSource === "langfuse" || urlSource === "eb" || urlSource === "agent")
      ) {
        setConversationsSource(urlSource);
      }
    }
    if (urlTimeRange && VALID_TIME_RANGE_VALUES.includes(urlTimeRange)) {
      setTimeRange(urlTimeRange);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch log sources on mount
  useEffect(() => {
    fetch("/api/log-sources")
      .then((res) => (res.ok ? res.json() : { sources: [] }))
      .then((data) => setSources(data.sources || []))
      .catch(() => setSources([]));
  }, []);

  // Fetch customer apps when customerId is submitted
  useEffect(() => {
    if (!submittedCustomerId) {
      setCustomerApps([]);
      return;
    }

    const controller = new AbortController();
    setCustomerAppsLoading(true);
    setCustomerAppsError(null);

    fetch(
      `/api/mgmt/customers/${encodeURIComponent(submittedCustomerId)}/apps`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) {
          if (res.status >= 500)
            throw new Error(
              `Internal error (${res.status}) — the management service may be temporarily unavailable`,
            );
          return res.json().then((d) => {
            throw new Error(d.error || `HTTP ${res.status}`);
          });
        }
        return res.json();
      })
      .then((data) => setCustomerApps(data))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setCustomerAppsError(
          err instanceof Error ? err.message : "Failed to fetch customer apps",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCustomerAppsLoading(false);
      });

    return () => controller.abort();
  }, [submittedCustomerId, customerAppsRefresh]);

  // Fetch app context when appId is submitted
  const fetchContext = useCallback(async () => {
    if (!submittedAppId) {
      setContext(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = `/api/app-context?appId=${encodeURIComponent(submittedAppId)}&timeRange=${timeRange}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch app details");
      }

      const data = await response.json();
      setContext(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch app details",
      );
    } finally {
      setLoading(false);
    }
  }, [submittedAppId, timeRange]);

  useEffect(() => {
    fetchContext();
  }, [fetchContext]);

  // Re-fetch summary when refresh key changes
  useEffect(() => {
    if (refreshKeys.summary > 0) {
      fetchContext();
    }
  }, [refreshKeys.summary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset mgmt data when the app changes
  useEffect(() => {
    setMgmtRawSubId(null);
    setMgmtGrantUserIds([]);
    setLlmSpend(null);
  }, [submittedAppId]);

  // Fetch LLM spend once grants are available from AppDetailsPanel (via onGrantsLoaded callback).
  // Uses llmBudgetUserId from ALL grants (active + historical) sourced from the mgmt API —
  // no dependency on the log-derived billing SID from app-context.
  useEffect(() => {
    if (mgmtGrantUserIds.length === 0) {
      setLlmSpend(null);
      return;
    }

    const controller = new AbortController();
    setLlmSpendLoading(true);
    setLlmSpendError(null);

    const params = new URLSearchParams();
    if (mgmtRawSubId) params.set("subscriptionId", mgmtRawSubId);
    for (const uid of mgmtGrantUserIds) {
      params.append("grantUserId", uid);
    }
    // Also include the subscription-level end_user (airo-builder:sid:<subId>) which
    // may carry spend from calls that use the subscription ID directly (e.g. older billing).
    if (mgmtRawSubId)
      params.append("grantUserId", `airo-builder:sid:${mgmtRawSubId}`);

    fetch(`/api/llm-spend?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to fetch LLM spend: ${res.status}`);
        return res.json();
      })
      .then((data) => setLlmSpend(data))
      .catch((err) => {
        if (err.name === "AbortError") return;
        setLlmSpend(null);
        setLlmSpendError(
          err instanceof Error ? err.message : "Failed to fetch LLM spend data",
        );
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLlmSpendLoading(false);
      });
    return () => controller.abort();
  }, [mgmtGrantUserIds, mgmtRawSubId]);

  const updateUrl = useCallback(
    (opts?: {
      appId?: string | null;
      customerId?: string | null;
      tab?: TabId;
      timeRange?: string;
      source?: ConversationsSource;
    }) => {
      const params = new URLSearchParams();
      const effectiveCustomerId =
        opts?.customerId !== undefined ? opts.customerId : submittedCustomerId;
      const effectiveAppId =
        opts?.appId !== undefined ? opts.appId : submittedAppId;
      const effectiveTab = opts?.tab ?? activeTab;
      const effectiveTimeRange = opts?.timeRange ?? timeRange;
      const effectiveSource = opts?.source ?? conversationsSource;

      if (effectiveCustomerId) {
        params.set("customerId", effectiveCustomerId);
      }
      if (effectiveAppId) {
        params.set("appId", effectiveAppId);
      }
      if (effectiveTab && effectiveTab !== "details") {
        params.set("tab", effectiveTab);
      }
      if (effectiveTimeRange && effectiveTimeRange !== "24h") {
        params.set("timeRange", effectiveTimeRange);
      }
      if (
        effectiveTab === "conversations" &&
        (effectiveSource === "agent" || effectiveSource === "eb")
      ) {
        params.set("source", effectiveSource);
      }

      const query = params.toString();
      router.push(query ? `/?${query}` : "/", { scroll: false });
    },
    [
      router,
      submittedAppId,
      submittedCustomerId,
      activeTab,
      timeRange,
      conversationsSource,
    ],
  );

  const isUUID = (value: string) => CUSTOMER_ID_RE.test(value);
  const isShopperId = (value: string) => SHOPPER_ID_RE.test(value);

  const [searchError, setSearchError] = useState<string | null>(null);
  const [resolvingShopper, setResolvingShopper] = useState(false);

  const handleSearch = async () => {
    // Resolution precedence (intentional):
    //   1. UUID  → treated as a customerId, loads that customer's apps.
    //   2. Numeric shopperId → resolved to a customerId via /api/shopper/:id,
    //      then handled like (1).
    //   3. Otherwise → treated as a literal appId.
    // Shopper IDs are constrained to 4-12 digits (SHOPPER_ID_RE) and UUIDs
    // never collide with that, so the order is unambiguous.
    const trimmed = appId.trim();
    if (!trimmed) return;

    setSearchError(null);

    if (isUUID(trimmed)) {
      setSubmittedAppId("");
      if (submittedCustomerId === trimmed) setCustomerAppsRefresh((k) => k + 1);
      setSubmittedCustomerId(trimmed);
      updateUrl({ customerId: trimmed, appId: null, tab: "details" });
      return;
    }

    if (isShopperId(trimmed)) {
      setResolvingShopper(true);
      try {
        const res = await fetch(`/api/shopper/${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchError(
            res.status === 404
              ? `Shopper ${trimmed} not found`
              : `Failed to resolve shopper (HTTP ${res.status})`,
          );
          return;
        }
        const customerId = data?.customerId;
        if (!customerId || !CUSTOMER_ID_RE.test(customerId)) {
          setSearchError(`No customerId returned for shopper ${trimmed}`);
          return;
        }
        setSubmittedAppId("");
        if (submittedCustomerId === customerId)
          setCustomerAppsRefresh((k) => k + 1);
        setSubmittedCustomerId(customerId);
        updateUrl({ customerId, appId: null, tab: "details" });
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : "Failed to resolve shopper",
        );
      } finally {
        setResolvingShopper(false);
      }
      return;
    }

    setSubmittedCustomerId("");
    setSubmittedAppId(trimmed);
    setActiveTab("details");
    updateUrl({ appId: trimmed, customerId: null, tab: "details" });
  };

  // Collect llmBudgetUserId from ALL grants (active + historical) so LLM Spend captures
  // spend across every billing period — deduplicated to avoid duplicate ES query terms.
  // Raw subscriptionId from mgmt is stored for display purposes only.
  const handleGrantsLoaded = useCallback(
    (subscriptionId: string, grants: MgmtSubscriptionGrants) => {
      setMgmtRawSubId(subscriptionId);
      const ids = [
        ...new Set(
          grants.grants
            .map((g) => g.llmBudgetUserId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      setMgmtGrantUserIds(ids);
    },
    [],
  );

  const handleAppLoaded = useCallback((app: MgmtAppDetails | null) => {
    setShopperId(app?.shopperId || null);
  }, []);

  // When user searches by appId alone, submittedCustomerId stays blank.
  // AppDetailsPanel fetches the subscription (which knows the customerId)
  // and bubbles it up here so the Investigate tab can stop short-circuiting
  // to "Enter a customer ID...".
  const handleCustomerIdLoaded = useCallback((customerId: string | null) => {
    if (!customerId) return;
    setSubmittedCustomerId((prev) => (prev === customerId ? prev : customerId));
  }, []);

  const handleClear = () => {
    setAppId("");
    setSubmittedAppId("");
    setSubmittedCustomerId("");
    setCustomerApps([]);
    setCustomerAppsError(null);
    setContext(null);
    setShopperId(null);
    setSearchError(null);
    setActiveTab("summary");
    router.push("/", { scroll: false });
  };

  const handleSelectCustomerApp = (selectedAppId: string) => {
    setSubmittedAppId(selectedAppId);
    setActiveTab("details");
    updateUrl({ appId: selectedAppId, tab: "details" });
  };

  const handleBackToCustomerApps = () => {
    setSubmittedAppId("");
    setContext(null);
    setActiveTab("details");
    updateUrl({ appId: null, tab: "details" });
  };

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    if (submittedAppId) {
      updateUrl({ tab: tabId });
    }
  };

  const handleConversationsSourceChange = (source: ConversationsSource) => {
    setConversationsSource(source);
    if (submittedAppId) {
      updateUrl({ tab: "conversations", source });
    }
  };

  const handleExpandError = async (errorMessage: string) => {
    if (expandedError === errorMessage) {
      setExpandedError(null);
      return;
    }

    setExpandedError(errorMessage);

    if (!errorDetails[errorMessage] && submittedAppId) {
      try {
        const response = await fetch(
          `/api/error-details?appId=${encodeURIComponent(submittedAppId)}&message=${encodeURIComponent(errorMessage)}&timeRange=${timeRange}`,
        );
        if (response.ok) {
          const data = await response.json();
          setErrorDetails((prev) => ({
            ...prev,
            [errorMessage]: data.errors || [],
          }));
        }
      } catch (err) {
        console.error("Failed to fetch error details:", err);
      }
    }
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: "details", label: "Details", icon: "🗂️" },
    { id: "summary", label: "Summary", icon: "📊" },
    { id: "conversations", label: "Conversations", icon: "💬" },
    { id: "logs", label: "Logs", icon: "📋" },
    { id: "care", label: "Care Contacts", icon: "🎧" },
    { id: "investigate", label: "Investigate", icon: "🔍" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f5f5f5",
        padding: "0.5rem 1.5rem",
      }}
    >
      <div>
        {/* Compact single-row header */}
        <header
          style={{
            backgroundColor: "white",
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "0.5rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            minHeight: "3.25rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "#1a1a1a",
              whiteSpace: "nowrap",
            }}
          >
            Airo AI Builder Console
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flex: 1,
            }}
          >
            <div style={{ position: "relative", flex: 1, maxWidth: "500px" }}>
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
                placeholder="App ID, Customer ID, or Shopper ID..."
                style={{
                  width: "100%",
                  padding: appId.trim()
                    ? "0.375rem 4.5rem 0.375rem 0.625rem"
                    : "0.375rem 1.75rem 0.375rem 0.625rem",
                  borderRadius: "4px",
                  border: "1px solid #d1d5db",
                  fontSize: "0.875rem",
                }}
              />
              {appId.trim() && (
                <span
                  style={{
                    position: "absolute",
                    right: "24px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    padding: "0.1rem 0.3rem",
                    borderRadius: "3px",
                    backgroundColor: isUUID(appId.trim())
                      ? "#dbeafe"
                      : isShopperId(appId.trim())
                        ? "#fef3c7"
                        : "#f0fdf4",
                    color: isUUID(appId.trim())
                      ? "#1d4ed8"
                      : isShopperId(appId.trim())
                        ? "#92400e"
                        : "#15803d",
                    pointerEvents: "none",
                  }}
                >
                  {isUUID(appId.trim())
                    ? "customerId"
                    : isShopperId(appId.trim())
                      ? "shopperId"
                      : "appId"}
                </span>
              )}
              {appId && (
                <button
                  onClick={handleClear}
                  style={{
                    position: "absolute",
                    right: "6px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "#e5e7eb",
                    border: "none",
                    borderRadius: "50%",
                    width: "16px",
                    height: "16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    color: "#6b7280",
                    fontWeight: "bold",
                  }}
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>
            <button
              onClick={handleSearch}
              disabled={!appId.trim() || resolvingShopper}
              style={{
                padding: "0.375rem 0.75rem",
                backgroundColor: appId.trim() ? "#3b82f6" : "#9ca3af",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: appId.trim() ? "pointer" : "not-allowed",
                fontSize: "0.875rem",
                fontWeight: 500,
                opacity: appId.trim() && !resolvingShopper ? 1 : 0.6,
              }}
            >
              {resolvingShopper ? "Resolving…" : "Search"}
            </button>
          </div>
          {loading && (
            <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              Loading...
            </span>
          )}
          {searchError && (
            <span
              style={{
                fontSize: "0.75rem",
                color: "#991b1b",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              {searchError}
            </span>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginLeft: "auto",
            }}
          >
            <a
              href="/analytics"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "0.375rem 0.875rem",
                backgroundColor: "#3b82f6",
                color: "white",
                borderRadius: "4px",
                textDecoration: "none",
                fontSize: "0.813rem",
                fontWeight: 600,
              }}
            >
              Analytics
            </a>
            <a
              href="/agentic-qa-results"
              style={{
                display: "inline-block",
                padding: "0.375rem 0.875rem",
                backgroundColor: "#6366f1",
                color: "white",
                borderRadius: "4px",
                textDecoration: "none",
                fontSize: "0.813rem",
                fontWeight: 600,
              }}
            >
              QA Results
            </a>
            <a
              href="/image-search"
              style={{
                display: "inline-block",
                padding: "0.375rem 0.875rem",
                backgroundColor: "#6b7280",
                color: "white",
                borderRadius: "4px",
                textDecoration: "none",
                fontSize: "0.813rem",
                fontWeight: 600,
              }}
            >
              Images
            </a>
            <UserMenu />
          </div>
        </header>

        {/* Main Content */}
        {submittedCustomerId && !submittedAppId ? (
          /* Customer apps list view */
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "6px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              overflow: "hidden",
              maxWidth: "1200px",
              margin: "0 auto",
            }}
          >
            <div
              style={{
                padding: "0.75rem 1rem",
                borderBottom: "1px solid #f3f4f6",
                backgroundColor: "#fafafa",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Customer: {submittedCustomerId}
              </span>
              {!customerAppsLoading && customerApps.length > 0 && (
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  ({customerApps.length} app
                  {customerApps.length !== 1 ? "s" : ""})
                </span>
              )}
            </div>
            <div style={{ padding: "0.75rem" }}>
              {customerAppsLoading ? (
                <div
                  style={{
                    padding: "3rem 2rem",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: "0.875rem",
                  }}
                >
                  Loading customer apps...
                </div>
              ) : customerAppsError ? (
                <div
                  style={{
                    padding: "1rem",
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    borderRadius: "4px",
                    fontSize: "0.813rem",
                  }}
                >
                  {customerAppsError}
                </div>
              ) : customerApps.length === 0 ? (
                <div
                  style={{
                    padding: "3rem 2rem",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: "0.875rem",
                  }}
                >
                  No apps found for this customer
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: "0.84rem",
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: "#f9fafb" }}>
                        <th
                          style={{
                            padding: "0.5rem 0.75rem",
                            textAlign: "left",
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          App ID
                        </th>
                        <th
                          style={{
                            padding: "0.5rem 0.75rem",
                            textAlign: "left",
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          Status
                        </th>
                        <th
                          style={{
                            padding: "0.5rem 0.75rem",
                            textAlign: "left",
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          Published
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerApps.map((app) => (
                        <tr
                          key={app.appId}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSelectCustomerApp(app.appId)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectCustomerApp(app.appId);
                            }
                          }}
                          style={{
                            borderBottom: "1px solid #f3f4f6",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = "#f0f7ff")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor = "")
                          }
                        >
                          <td style={{ padding: "0.5rem 0.75rem" }}>
                            <div
                              style={{
                                fontFamily: "monospace",
                                color: "#2563eb",
                                fontWeight: 600,
                              }}
                            >
                              {app.appId}
                            </div>
                            <div
                              style={{
                                fontFamily: "monospace",
                                fontSize: "0.68rem",
                                color: "#9ca3af",
                                marginTop: "0.1rem",
                              }}
                            >
                              {app.subscriptionId}
                            </div>
                          </td>
                          <td style={{ padding: "0.5rem 0.75rem" }}>
                            <span
                              style={{
                                fontSize: "0.72rem",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "9999px",
                                fontWeight: 600,
                                backgroundColor:
                                  app.status === "RUNNING"
                                    ? "#dcfce7"
                                    : app.status === "STOPPED"
                                      ? "#fee2e2"
                                      : "#f3f4f6",
                                color:
                                  app.status === "RUNNING"
                                    ? "#166534"
                                    : app.status === "STOPPED"
                                      ? "#991b1b"
                                      : "#374151",
                              }}
                            >
                              {app.status}
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "0.5rem 0.75rem",
                              color: app.published ? "#16a34a" : "#6b7280",
                            }}
                          >
                            {app.published ? "Yes" : "No"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : !submittedAppId ? (
          <div
            style={{
              backgroundColor: "white",
              padding: "4rem 2rem",
              borderRadius: "8px",
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
            <h2
              style={{
                margin: "0 0 0.5rem 0",
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "#1a1a1a",
              }}
            >
              Enter an App ID, Customer ID, or Shopper ID to get started
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: "0.875rem",
                color: "#6b7280",
              }}
            >
              View logs, conversation history, and error summaries for your app
            </p>
          </div>
        ) : (
          <div
            style={{
              backgroundColor: "white",
              borderRadius: "6px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              minHeight: "calc(100vh - 3.5rem)",
            }}
          >
            {/* App ID label / breadcrumb */}
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderBottom: "1px solid #f3f4f6",
                backgroundColor: "#fafafa",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              {submittedCustomerId && (
                <>
                  <button
                    onClick={handleBackToCustomerApps}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontSize: "0.813rem",
                      color: "#2563eb",
                      fontWeight: 600,
                      padding: 0,
                    }}
                  >
                    Customer: {submittedCustomerId}
                  </button>
                  <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                    &gt;
                  </span>
                </>
              )}
              <span
                style={{
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                app id - {submittedAppId}
              </span>
            </div>
            {/* Tabs bar — centered */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderBottom: "1px solid #e5e7eb",
                backgroundColor: "#fafafa",
                gap: "0",
              }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor:
                      activeTab === tab.id ? "white" : "transparent",
                    border: "none",
                    borderBottom:
                      activeTab === tab.id
                        ? "2px solid #3b82f6"
                        : "2px solid transparent",
                    cursor: "pointer",
                    fontSize: "0.84rem",
                    fontWeight: activeTab === tab.id ? 600 : 500,
                    color: activeTab === tab.id ? "#3b82f6" : "#6b7280",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div style={{ padding: "0.75rem", flex: 1 }}>
              {error && (
                <div
                  style={{
                    backgroundColor: "#fef2f2",
                    color: "#991b1b",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "4px",
                    marginBottom: "0.5rem",
                    fontSize: "0.813rem",
                  }}
                >
                  {error}
                </div>
              )}

              {/* Details Tab — lazy-mounted on first visit */}
              {visitedTabs.has("details") && (
              <div
                style={{
                  display: activeTab === "details" ? "flex" : "none",
                  flexDirection: "column",
                  gap: "1rem",
                  maxWidth: "1200px",
                  margin: "0 auto",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Support Bundle controls */}
                  {bundleDownloading && (
                    <style>{`@keyframes bundle-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                  )}
                  <select
                    aria-label="Support bundle time window"
                    value={bundleWindow}
                    onChange={(e) => setBundleWindow(e.target.value)}
                    style={{
                      padding: "0.5rem 0.625rem",
                      fontSize: "0.813rem",
                      border: "1px solid #d1d5db",
                      borderRadius: "6px",
                      backgroundColor: "white",
                      color: "#374151",
                      cursor: "pointer",
                    }}
                  >
                    <option value="30">30 min before last activity</option>
                    <option value="60">1 hour before last activity</option>
                    <option value="360">6 hours before last activity</option>
                    <option value="1440">24 hours before last activity</option>
                  </select>
                  <button
                    onClick={handleDownloadBundle}
                    disabled={bundleDownloading || !submittedAppId}
                    title="Download recent observations and logs for this app"
                    style={{
                      padding: "0.5rem 0.875rem",
                      backgroundColor: bundleDownloading
                        ? "#9ca3af"
                        : "#059669",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor:
                        bundleDownloading || !submittedAppId
                          ? "not-allowed"
                          : "pointer",
                      fontSize: "0.813rem",
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      opacity: !submittedAppId ? 0.5 : 1,
                    }}
                  >
                    {bundleDownloading ? (
                      <>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            animation: "bundle-spin 1s linear infinite",
                            display: "inline-block",
                          }}
                        >
                          <path d="M23 4v6h-6" />
                          <path d="M1 20v-6h6" />
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        Downloading...
                      </>
                    ) : (
                      <>
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Support Bundle
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleRefreshTab("details")}
                    style={{
                      padding: "0.625rem 1.25rem",
                      backgroundColor: "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                    }}
                  >
                    Refresh
                  </button>
                </div>
                {bundleError && (
                  <div
                    style={{
                      padding: "0.5rem 0.75rem",
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      borderRadius: "6px",
                      fontSize: "0.813rem",
                      color: "#dc2626",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Bundle download failed: {bundleError}</span>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={() => setBundleError(null)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#dc2626",
                        cursor: "pointer",
                        fontSize: "1rem",
                        lineHeight: 1,
                        padding: "0 0.25rem",
                      }}
                    >
                      x
                    </button>
                  </div>
                )}
                <AppDetailsPanel
                  appId={submittedAppId}
                  refreshKey={refreshKeys.details}
                  onRefresh={() => handleRefreshTab("details")}
                  onGrantsLoaded={handleGrantsLoaded}
                  onAppLoaded={handleAppLoaded}
                  onCustomerIdLoaded={handleCustomerIdLoaded}
                  llmSpend={llmSpend}
                  llmSpendLoading={llmSpendLoading}
                  llmSpendError={llmSpendError}
                />
              </div>
              )}

              {/* Summary Tab — lazy-mounted on first visit */}
              {visitedTabs.has("summary") && (
              <div
                style={{
                  display: activeTab === "summary" ? "flex" : "none",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                {/* Time range + Refresh */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <label
                    style={{
                      fontSize: "0.813rem",
                      color: "#6b7280",
                    }}
                  >
                    Time range:
                  </label>
                  <select
                    value={timeRange}
                    onChange={(e) => {
                      setTimeRange(e.target.value);
                      updateUrl({ timeRange: e.target.value });
                    }}
                    style={{
                      padding: "0.375rem 0.5rem",
                      borderRadius: "4px",
                      border: "1px solid #d1d5db",
                      fontSize: "0.875rem",
                      backgroundColor: "white",
                      cursor: "pointer",
                    }}
                  >
                    {TIME_RANGES.map((range) => (
                      <option key={range.value} value={range.value}>
                        {range.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleRefreshTab("summary")}
                    disabled={loading}
                    style={{
                      padding: "0.625rem 1.25rem",
                      backgroundColor: loading ? "#9ca3af" : "#3b82f6",
                      color: "white",
                      border: "none",
                      borderRadius: "6px",
                      cursor: loading ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      opacity: loading ? 0.6 : 1,
                    }}
                  >
                    Refresh
                  </button>
                </div>

                {/* Loading State */}
                {loading || !context ? (
                  <div
                    style={{
                      padding: "3rem 2rem",
                      textAlign: "center",
                      backgroundColor: "#f9fafb",
                      borderRadius: "6px",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <div
                      style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}
                    >
                      ⏳
                    </div>
                    <p
                      style={{
                        margin: 0,
                        color: "#6b7280",
                        fontSize: "0.875rem",
                      }}
                    >
                      Loading error summary...
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Error Summary Header */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "1rem",
                        backgroundColor: context.errorSummary?.total
                          ? "#fef2f2"
                          : "#f0fdf4",
                        borderRadius: "6px",
                        border: context.errorSummary?.total
                          ? "1px solid #fecaca"
                          : "1px solid #bbf7d0",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1rem",
                            fontWeight: 600,
                            color: context.errorSummary?.total
                              ? "#991b1b"
                              : "#166534",
                          }}
                        >
                          Error Summary
                        </h3>
                        <div
                          style={{
                            fontSize: "0.75rem",
                            fontStyle: "italic",
                            color: context.errorSummary?.total
                              ? "#991b1b"
                              : "#166534",
                            opacity: 0.75,
                          }}
                        >
                          Errors don&apos;t mean the user wasted credits — correlate with chats to confirm.
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "1.5rem",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        <div style={{ textAlign: "center" }}>
                          <div
                            style={{
                              fontSize: "1.5rem",
                              fontWeight: 700,
                              color: context.errorSummary?.total
                                ? "#dc2626"
                                : "#16a34a",
                            }}
                          >
                            {context.errorSummary?.total ?? 0}
                          </div>
                          <div
                            style={{ fontSize: "0.75rem", color: "#6b7280" }}
                          >
                            Total Errors
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Error Groups */}
                    {context.errorSummary?.errorGroups &&
                    context.errorSummary.errorGroups.length > 0 ? (
                      <div
                        style={{
                          padding: "1rem",
                          backgroundColor: "#f9fafb",
                          borderRadius: "6px",
                          border: "1px solid #e5e7eb",
                        }}
                      >
                        <h4
                          style={{
                            margin: "0 0 0.75rem 0",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            color: "#374151",
                          }}
                        >
                          Errors by Message
                        </h4>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.5rem",
                          }}
                        >
                          {context.errorSummary.errorGroups.map(
                            (group, index) => (
                              <div key={index}>
                                <div
                                  onClick={() =>
                                    handleExpandError(group.message)
                                  }
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "0.75rem 1rem",
                                    backgroundColor:
                                      expandedError === group.message
                                        ? "#fef2f2"
                                        : "white",
                                    borderRadius:
                                      expandedError === group.message
                                        ? "4px 4px 0 0"
                                        : "4px",
                                    border: "1px solid #e5e7eb",
                                    cursor: "pointer",
                                  }}
                                >
                                  <div
                                    style={{
                                      flex: 1,
                                      fontSize: "0.875rem",
                                      color: "#374151",
                                      wordBreak: "break-word",
                                      marginRight: "1rem",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontSize: "0.75rem",
                                          color: "#6b7280",
                                        }}
                                      >
                                        {expandedError === group.message
                                          ? "▼"
                                          : "▶"}
                                      </span>
                                      <div>
                                        {group.event && (
                                          <span
                                            style={{
                                              fontSize: "0.7rem",
                                              fontFamily: "monospace",
                                              color: "#6366f1",
                                              backgroundColor: "#eef2ff",
                                              padding: "0.125rem 0.375rem",
                                              borderRadius: "3px",
                                              marginRight: "0.5rem",
                                            }}
                                          >
                                            {group.event}
                                          </span>
                                        )}
                                        {group.message}
                                      </div>
                                    </div>
                                    {group.lastSeen && (
                                      <div
                                        style={{
                                          fontSize: "0.7rem",
                                          color: "#6b7280",
                                          marginTop: "0.25rem",
                                          fontFamily: "monospace",
                                          marginLeft: "1.25rem",
                                        }}
                                      >
                                        Last seen:{" "}
                                        {formatTimestamp(group.lastSeen)}
                                      </div>
                                    )}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: "0.875rem",
                                      fontWeight: 600,
                                      color: "#dc2626",
                                      backgroundColor: "#fef2f2",
                                      padding: "0.25rem 0.75rem",
                                      borderRadius: "9999px",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {group.count}×
                                  </div>
                                </div>
                                {expandedError === group.message && (
                                  <div
                                    style={{
                                      padding: "0.75rem 1rem",
                                      backgroundColor: "#f9fafb",
                                      borderRadius: "0 0 4px 4px",
                                      border: "1px solid #e5e7eb",
                                      borderTop: "none",
                                    }}
                                  >
                                    {!errorDetails[group.message] ? (
                                      <div
                                        style={{
                                          fontSize: "0.75rem",
                                          color: "#6b7280",
                                        }}
                                      >
                                        Loading details...
                                      </div>
                                    ) : errorDetails[group.message].length ===
                                      0 ? (
                                      <div
                                        style={{
                                          fontSize: "0.75rem",
                                          color: "#6b7280",
                                        }}
                                      >
                                        No detailed instances found
                                      </div>
                                    ) : (
                                      <div
                                        style={{
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "0.5rem",
                                        }}
                                      >
                                        {errorDetails[group.message]
                                          .slice(0, 5)
                                          .map((detail, idx) => (
                                            <div
                                              key={idx}
                                              style={{
                                                padding: "0.5rem",
                                                backgroundColor: "white",
                                                borderRadius: "4px",
                                                border: "1px solid #e5e7eb",
                                                fontSize: "0.75rem",
                                              }}
                                            >
                                              <div
                                                style={{
                                                  display: "flex",
                                                  gap: "1rem",
                                                  marginBottom: "0.25rem",
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    color: "#6b7280",
                                                    fontFamily: "monospace",
                                                  }}
                                                >
                                                  {formatTimestamp(
                                                    detail.timestamp,
                                                  )}
                                                </span>
                                                {detail.event && (
                                                  <span
                                                    style={{ color: "#3b82f6" }}
                                                  >
                                                    {detail.event}
                                                  </span>
                                                )}
                                                {detail.service && (
                                                  <span
                                                    style={{ color: "#059669" }}
                                                  >
                                                    {detail.service}
                                                  </span>
                                                )}
                                              </div>
                                              <div
                                                style={{
                                                  color: "#374151",
                                                  wordBreak: "break-word",
                                                }}
                                              >
                                                {detail.message}
                                              </div>
                                              {!!detail.raw?.data && (
                                                <details
                                                  style={{
                                                    marginTop: "0.25rem",
                                                  }}
                                                >
                                                  <summary
                                                    style={{
                                                      cursor: "pointer",
                                                      color: "#6b7280",
                                                      fontSize: "0.7rem",
                                                    }}
                                                  >
                                                    View raw data
                                                  </summary>
                                                  <pre
                                                    style={{
                                                      marginTop: "0.25rem",
                                                      padding: "0.5rem",
                                                      backgroundColor:
                                                        "#1f2937",
                                                      color: "#f3f4f6",
                                                      borderRadius: "4px",
                                                      fontSize: "0.65rem",
                                                      overflow: "auto",
                                                      maxHeight: "200px",
                                                    }}
                                                  >
                                                    {JSON.stringify(
                                                      detail.raw.data,
                                                      null,
                                                      2,
                                                    )}
                                                  </pre>
                                                </details>
                                              )}
                                            </div>
                                          ))}
                                        {errorDetails[group.message].length >
                                          5 && (
                                          <div
                                            style={{
                                              fontSize: "0.7rem",
                                              color: "#6b7280",
                                              textAlign: "center",
                                            }}
                                          >
                                            Showing 5 of{" "}
                                            {errorDetails[group.message].length}{" "}
                                            instances
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    ) : context.errorSummary?.total === 0 ? (
                      <div
                        style={{
                          padding: "2rem",
                          textAlign: "center",
                          color: "#166534",
                          backgroundColor: "#f0fdf4",
                          borderRadius: "6px",
                          border: "1px solid #bbf7d0",
                        }}
                      >
                        ✓ No errors found in the selected time range
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              )}

              {/* Conversations Tab (Langfuse + Agent) — lazy-mounted on first visit */}
              {visitedTabs.has("conversations") && (
                <div
                  style={{
                    display: activeTab === "conversations" ? "block" : "none",
                  }}
                >
                  <ConversationsPanel
                    globalAppId={submittedAppId}
                    refreshKey={refreshKeys.conversations}
                    onRefresh={() => handleRefreshTab("conversations")}
                    source={conversationsSource}
                    onSourceChange={handleConversationsSourceChange}
                  />
                </div>
              )}

              {/* Care Tab — lazy-mounted on first visit */}
              {visitedTabs.has("care") && (
                <div style={{ display: activeTab === "care" ? "block" : "none" }}>
                  <CarePanel
                    shopperId={shopperId}
                    refreshKey={refreshKeys.care}
                    onRefresh={() => handleRefreshTab("care")}
                  />
                </div>
              )}

              {/* Logs Tab — lazy-mounted on first visit */}
              {visitedTabs.has("logs") && (
                <div style={{ display: activeTab === "logs" ? "block" : "none" }}>
                  <LogsPanel
                    sources={sources}
                    globalAppId={submittedAppId}
                    timeRange={timeRange}
                    refreshKey={refreshKeys.logs}
                    onRefresh={() => handleRefreshTab("logs")}
                  />
                </div>
              )}

              {/* Investigate Tab — lazy-mounted on first visit. Requires
                  both appId and customerId; the panel auto-loads the most
                  recent investigation from S3 so reopening the tab shows
                  the last report without rerunning. */}
              {visitedTabs.has("investigate") && (
                <div style={{ display: activeTab === "investigate" ? "block" : "none" }}>
                  {submittedAppId && submittedCustomerId ? (
                    <InvestigatePanel
                      appId={submittedAppId}
                      customerId={submittedCustomerId}
                    />
                  ) : (
                    <div style={{ color: "#6b7280", fontSize: 13, padding: 16 }}>
                      Enter an App ID and Customer / Shopper ID above to run an investigation.
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
