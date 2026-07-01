import { useEffect, useRef, useState } from "react";
import { Helmet } from "@dr.pogodin/react-helmet";
import { cn } from "@/lib/utils";
import { ALL_FEATURES } from "@/lib/features";

type Tab = "api" | "log" | "db" | "session" | "env" | "features";

const API_ENDPOINTS = [
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/services",
    desc: "List all active services",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/services/:id",
    desc: "Get service by ID",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/services/slug/:slug",
    desc: "Get service by slug",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/services/:id/available-slots-by-date-range",
    desc: "Available dates for a service",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/services/:id/availability-times",
    desc: "Time slots for a date",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/categories",
    desc: "List categories",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/categories/:id/services",
    desc: "Services in a category",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/questions",
    desc: "Booking questions",
  },
  {
    ns: "Public",
    method: "GET",
    path: "/api/appointments/public/config",
    desc: "Public business config",
  },
  {
    ns: "Public",
    method: "POST",
    path: "/api/appointments/public/bookings",
    desc: "Create a booking",
  },
  { ns: "Auth", method: "POST", path: "/api/auth/signup", desc: "Register a new customer" },
  { ns: "Auth", method: "POST", path: "/api/auth/login", desc: "Login as customer" },
  { ns: "Auth", method: "POST", path: "/api/auth/logout", desc: "Logout customer session" },
  { ns: "Auth", method: "GET", path: "/api/auth/me", desc: "Current session user" },
  {
    ns: "Customer",
    method: "GET",
    path: "/api/appointments/customer/my-bookings",
    desc: "My bookings (auth required)",
  },
  {
    ns: "Customer",
    method: "GET",
    path: "/api/appointments/customer/my-bookings/:id",
    desc: "Booking detail (auth required)",
  },
  {
    ns: "Customer",
    method: "GET",
    path: "/api/appointments/customer/lookup",
    desc: "Lookup bookings by email",
  },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/auth/setup",
    desc: "Check if admin is set up",
  },
  {
    ns: "Admin",
    method: "POST",
    path: "/api/appointments/admin/auth/setup",
    desc: "Initialize admin credentials",
  },
  { ns: "Admin", method: "POST", path: "/api/appointments/admin/auth/login", desc: "Admin login" },
  {
    ns: "Admin",
    method: "POST",
    path: "/api/appointments/admin/auth/logout",
    desc: "Admin logout",
  },
  { ns: "Admin", method: "GET", path: "/api/appointments/admin/bookings", desc: "List bookings" },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/bookings/summary",
    desc: "Booking stats summary",
  },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/bookings/upcoming",
    desc: "Upcoming bookings",
  },
  { ns: "Admin", method: "POST", path: "/api/appointments/admin/bookings", desc: "Create booking" },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/bookings/:id",
    desc: "Booking detail",
  },
  {
    ns: "Admin",
    method: "PATCH",
    path: "/api/appointments/admin/bookings/:id",
    desc: "Update booking",
  },
  {
    ns: "Admin",
    method: "DELETE",
    path: "/api/appointments/admin/bookings/:id",
    desc: "Delete booking",
  },
  {
    ns: "Admin",
    method: "PATCH",
    path: "/api/appointments/admin/bookings/:id/mark-as-paid",
    desc: "Mark booking as paid",
  },
  { ns: "Admin", method: "GET", path: "/api/appointments/admin/services", desc: "List services" },
  { ns: "Admin", method: "POST", path: "/api/appointments/admin/services", desc: "Create service" },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/services/:id",
    desc: "Service detail",
  },
  {
    ns: "Admin",
    method: "PATCH",
    path: "/api/appointments/admin/services/:id",
    desc: "Update service",
  },
  {
    ns: "Admin",
    method: "DELETE",
    path: "/api/appointments/admin/services/:id",
    desc: "Delete service",
  },
  { ns: "Admin", method: "GET", path: "/api/appointments/admin/clients", desc: "List clients" },
  { ns: "Admin", method: "POST", path: "/api/appointments/admin/clients", desc: "Create client" },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/clients/:id",
    desc: "Client detail",
  },
  {
    ns: "Admin",
    method: "PATCH",
    path: "/api/appointments/admin/clients/:id",
    desc: "Update client",
  },
  {
    ns: "Admin",
    method: "DELETE",
    path: "/api/appointments/admin/clients/:id",
    desc: "Delete client",
  },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/clients/:id/bookings",
    desc: "Client bookings",
  },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/business-settings",
    desc: "Business settings",
  },
  {
    ns: "Admin",
    method: "POST",
    path: "/api/appointments/admin/business-settings/batch-upsert",
    desc: "Update settings",
  },
  {
    ns: "Admin",
    method: "GET",
    path: "/api/appointments/admin/categories",
    desc: "List categories",
  },
];

const METHOD_COLORS: Record<string, string> = {
  GET: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  POST: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  PATCH: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  DELETE: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const STATUS_COLORS = (s: number) => {
  if (s < 300) return "text-green-600 dark:text-green-400";
  if (s < 400) return "text-blue-600 dark:text-blue-400";
  if (s < 500) return "text-yellow-600 dark:text-yellow-400";
  return "text-destructive";
};

interface LogEntry {
  method: string;
  path: string;
  status: number;
  ms: number;
  ts: string;
}
interface DbData {
  tables: Record<string, { count: number; rows: unknown[] }>;
}
interface EnvData {
  nodeVersion: string;
  nodeEnv: string;
  dbConnected: boolean;
  dbUrl: string | null;
}
interface SessionData {
  user: unknown;
  cookies: Record<string, string>;
}

export default function DebugPage() {
  const [tab, setTab] = useState<Tab>("api");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [db, setDb] = useState<DbData | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [env, setEnv] = useState<EnvData | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const logRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (tab === "log") {
      const poll = () =>
        fetch("/debug-data/log")
          .then((r) => r.json() as Promise<{ log?: LogEntry[] }>)
          .then((d) => setLog(d.log ?? []))
          .catch(() => {
            /* ignored */
          });
      void poll();
      logRef.current = setInterval(() => void poll(), 2000);
    }
    return () => {
      if (logRef.current) clearInterval(logRef.current);
    };
  }, [tab]);

  useEffect(() => {
    if (tab === "db" && !db) {
      setDbLoading(true);
      fetch("/debug-data/db")
        .then((r) => r.json())
        .then(setDb)
        .catch(() => {
          /* ignored */
        })
        .finally(() => setDbLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch once when tab switches to "db"
  }, [tab]);

  useEffect(() => {
    if (tab === "env" && !env) {
      fetch("/debug-data/env")
        .then((r) => r.json())
        .then(setEnv)
        .catch(() => {
          /* ignored */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fetch once when tab switches to "env"
  }, [tab]);

  useEffect(() => {
    if (tab === "session") {
      const cookies: Record<string, string> = {};
      document.cookie.split(";").forEach((c) => {
        const [k, ...v] = c.trim().split("=");
        if (k) cookies[k] = v.join("=");
      });
      fetch("/api/auth/me", { credentials: "include" })
        .then((r) => r.json())
        .then((user) => setSession({ user, cookies }))
        .catch(() => setSession({ user: null, cookies }));
    }
  }, [tab]);

  const namespaces = [...new Set(API_ENDPOINTS.map((e) => e.ns))];
  const tabs: { id: Tab; label: string }[] = [
    { id: "api", label: "API Reference" },
    { id: "log", label: "Live Log" },
    { id: "db", label: "Database" },
    { id: "session", label: "Session" },
    { id: "env", label: "Environment" },
    { id: "features", label: "Feature Flags" },
  ];

  return (
    <>
      <Helmet>
        <title>Debug Console</title>
      </Helmet>
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Debug Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live developer info — API catalog, request log, DB state, session, and environment.
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
                tab === t.id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* API Reference */}
        {tab === "api" && (
          <div className="space-y-6">
            {namespaces.map((ns) => (
              <div key={ns}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {ns}
                </h2>
                <div className="overflow-hidden rounded-xl border border-border">
                  {API_ENDPOINTS.filter((e) => e.ns === ns).map((e, i, arr) => (
                    <div
                      key={e.path + e.method}
                      className={cn(
                        "flex items-center gap-3 bg-card px-4 py-2.5 text-sm",
                        i < arr.length - 1 && "border-b border-border",
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold",
                          METHOD_COLORS[e.method] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {e.method}
                      </span>
                      <code className="flex-1 font-mono text-xs text-foreground">{e.path}</code>
                      <span className="hidden text-xs text-muted-foreground sm:block">
                        {e.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live Log */}
        {tab === "log" && (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex justify-between border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
              <span>Last {log.length} requests (polling every 2s)</span>
              <span className="text-green-500">● live</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="border-b border-border bg-muted">
                  <tr>
                    {["Method", "Path", "Status", "ms", "Time"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {log.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                        No requests yet
                      </td>
                    </tr>
                  ) : (
                    log.map((e, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i} className="bg-card">
                        <td className="px-4 py-1.5">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-xs font-semibold",
                              METHOD_COLORS[e.method] ?? "bg-muted text-muted-foreground",
                            )}
                          >
                            {e.method}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 text-foreground">{e.path}</td>
                        <td className={cn("px-4 py-1.5 font-semibold", STATUS_COLORS(e.status))}>
                          {e.status}
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground">{e.ms}ms</td>
                        <td className="px-4 py-1.5 text-muted-foreground">
                          {new Date(e.ts).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Database */}
        {tab === "db" && (
          <div className="space-y-3">
            {dbLoading && <p className="text-sm text-muted-foreground">Loading database...</p>}
            {db &&
              Object.entries(db.tables).map(([name, info]) => (
                <div key={name} className="overflow-hidden rounded-xl border border-border">
                  <button
                    className="flex w-full items-center justify-between bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
                    onClick={() => setExpandedTable(expandedTable === name ? null : name)}
                  >
                    <span className="font-mono text-sm font-medium text-foreground">{name}</span>
                    <span className="text-xs text-muted-foreground">{info.count} rows</span>
                  </button>
                  {expandedTable === name && info.rows.length > 0 && (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full font-mono text-xs">
                        <thead className="bg-muted">
                          <tr>
                            {Object.keys(info.rows[0] as Record<string, unknown>).map((k) => (
                              <th
                                key={k}
                                className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                              >
                                {k}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {info.rows.map((row, i) => (
                            // eslint-disable-next-line react/no-array-index-key
                            <tr key={i} className="bg-card">
                              {Object.values(row as Record<string, unknown>).map((v, j) => (
                                <td
                                  // eslint-disable-next-line react/no-array-index-key
                                  key={j}
                                  className="max-w-xs truncate whitespace-nowrap px-3 py-1.5 text-foreground"
                                >
                                  {v === null || v === undefined ? (
                                    <span className="text-muted-foreground/50">null</span>
                                  ) : typeof v === "object" ? (
                                    JSON.stringify(v)
                                  ) : (
                                    String(v as string | number | boolean)
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {expandedTable === name && info.rows.length === 0 && (
                    <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
                      Empty table
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* Session */}
        {tab === "session" && session && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="border-b border-border bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current user (/api/auth/me)
              </div>
              <pre className="overflow-auto bg-card px-4 py-3 font-mono text-xs text-foreground">
                {JSON.stringify(session.user, null, 2)}
              </pre>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="border-b border-border bg-muted px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cookies
              </div>
              {Object.entries(session.cookies).length === 0 ? (
                <p className="px-4 py-3 text-xs text-muted-foreground">No cookies found</p>
              ) : (
                <table className="w-full font-mono text-xs">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                        Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {Object.entries(session.cookies).map(([k, v]) => (
                      <tr key={k} className="bg-card">
                        <td className="px-4 py-2 text-foreground">{k}</td>
                        <td className="max-w-sm truncate px-4 py-2 text-muted-foreground">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Feature Flags */}
        {tab === "features" && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Configured in <code className="font-mono">appointment-features.json</code>. Changes
              require a server restart.
            </p>
            {[...new Set(ALL_FEATURES.map((f) => f.key.split(".")[0]))].map((ns) => {
              const nsFeatures = ALL_FEATURES.filter((f) => f.key.startsWith(`${ns}.`));
              return (
                <div key={ns}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {ns}
                  </h2>
                  <div className="overflow-hidden rounded-xl border border-border">
                    {nsFeatures.map((f, i) => {
                      const depth = (f.key.match(/\./g) ?? []).length - 1;
                      const isSub = depth > 0;
                      return (
                        <div
                          key={f.key}
                          style={
                            isSub
                              ? { paddingLeft: `${depth * 1.25 + 1}rem`, paddingRight: "1rem" }
                              : undefined
                          }
                          className={cn(
                            "flex items-center gap-3 bg-card py-2 text-sm",
                            i < nsFeatures.length - 1 && "border-b border-border",
                            !isSub && "px-4",
                          )}
                        >
                          {isSub && (
                            <span className="shrink-0 select-none text-muted-foreground/40">└</span>
                          )}
                          <span
                            className={cn(
                              "w-10 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs font-semibold",
                              f.enabled
                                ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300"
                                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
                            )}
                          >
                            {f.enabled ? "ON" : "OFF"}
                          </span>
                          <code
                            className={cn(
                              "flex-1 font-mono text-xs",
                              isSub ? "text-muted-foreground" : "text-foreground",
                            )}
                          >
                            {f.key}
                          </code>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Environment */}
        {tab === "env" && env && (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {[
                  ["Node version", env.nodeVersion],
                  ["Environment", env.nodeEnv],
                  ["DB connected", env.dbConnected ? "Yes" : "No"],
                  ["DB URL (masked)", env.dbUrl ?? "not set"],
                ].map(([k, v]) => (
                  <tr key={k} className="bg-card">
                    <td className="w-40 px-4 py-3 font-medium text-foreground">{k}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
