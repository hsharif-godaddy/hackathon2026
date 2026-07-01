import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagsContext";
import { getPublicConfig } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/admin/badges";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Search,
} from "lucide-react";

interface Booking {
  id: string;
  uniqueId?: string;
  status: string;
  startTime: string;
  endTime: string;
  quantity: number;
  serviceName: string | null;
  clientEmail: string | null;
  staffName: string | null;
}

interface PaginatedResponse {
  results: Booking[];
  total_count: number;
  page: number;
  per_page: number;
  total_pages: number;
}

type Column = "service" | "client" | "staff" | "date" | "status";

const BASE_COLUMNS: { key: Column; label: string }[] = [
  { key: "service", label: "Service" },
  { key: "client", label: "Client" },
  { key: "date", label: "Date & Time" },
  { key: "status", label: "Status" },
];

const STATUSES = ["all", "paid", "unpaid", "pending", "cancelled"] as const;
const PAGE_SIZES = [10, 15, 25, 50];

export default function AdminBookingsPage() {
  const { token } = useAdminAuth();
  const { isEnabled } = useFeatureFlags();
  const staffEnabled = isEnabled("admin.staff");
  const navigate = useNavigate();
  const ALL_COLUMNS = staffEnabled
    ? [
        ...BASE_COLUMNS.slice(0, 2),
        { key: "staff" as Column, label: "Staff" },
        ...BASE_COLUMNS.slice(2),
      ]
    : BASE_COLUMNS;
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);
  const [perPage, setPerPage] = useState(15);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [visibleCols, setVisibleCols] = useState<Set<Column>>(
    new Set(
      staffEnabled
        ? ["service", "client", "staff", "date", "status"]
        : ["service", "client", "date", "status"],
    ),
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
        if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
        const res = await adminFetch(`/api/appointments/admin/bookings?${params}`, token);
        if (res.ok) setData((await res.json()) as PaginatedResponse);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [page, perPage, statusFilter, token]);

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(1);
  }

  function toggleCol(col: Column) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        if (next.size > 1) next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }

  const filteredRows =
    data?.results.filter((b) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (b.serviceName ?? "").toLowerCase().includes(q) ||
        (b.clientEmail ?? "").toLowerCase().includes(q) ||
        (b.staffName ?? "").toLowerCase().includes(q) ||
        (b.uniqueId ?? b.id).toLowerCase().includes(q)
      );
    }) ?? [];

  const colCount = visibleCols.size + 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {data?.total_count ?? 0} total bookings
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={statusFilter} onValueChange={handleStatusChange}>
          <TabsList className="h-9">
            {STATUSES.map((s) => (
              <TabsTrigger key={s} value={s} className="px-3 text-xs capitalize">
                {s === "all" ? "All" : s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search bookings…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-48 pl-8 text-sm"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <Columns2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {ALL_COLUMNS.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.key}
                  checked={visibleCols.has(col.key)}
                  onCheckedChange={() => toggleCol(col.key)}
                >
                  {col.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              {visibleCols.has("service") && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Service</th>
              )}
              {visibleCols.has("client") && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Client</th>
              )}
              {visibleCols.has("staff") && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Staff</th>
              )}
              {visibleCols.has("date") && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Date & Time
                </th>
              )}
              {visibleCols.has("status") && (
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              )}
              <th className="w-8 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td colSpan={colCount} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-sm text-muted-foreground">
                  {search ? `No bookings matching "${search}"` : "No bookings found"}
                </td>
              </tr>
            ) : (
              filteredRows.map((b) => (
                <tr
                  key={b.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => {
                    void navigate(`/admin/bookings/${b.id}`);
                  }}
                >
                  {visibleCols.has("service") && (
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">
                        {b.serviceName ?? `#${(b.uniqueId ?? b.id).slice(0, 8)}`}
                      </p>
                    </td>
                  )}
                  {visibleCols.has("client") && (
                    <td className="px-4 py-3 text-muted-foreground">{b.clientEmail ?? "—"}</td>
                  )}
                  {visibleCols.has("staff") && (
                    <td className="px-4 py-3">
                      {b.staffName ? (
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {b.staffName.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-foreground">{b.staffName}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {visibleCols.has("date") && (
                    <td className="px-4 py-3 text-foreground">
                      {b.startTime
                        ? new Date(b.startTime).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: timezone,
                          })
                        : "—"}
                    </td>
                  )}
                  {visibleCols.has("status") && (
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-3">
          <div className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <span>Rows per page</span>
            <Select
              value={String(perPage)}
              onValueChange={(v) => {
                setPerPage(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mx-auto flex items-center gap-2 text-sm text-muted-foreground sm:mx-0">
            Page {data?.page ?? 1} of {data?.total_pages ?? 1}
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="hidden h-7 w-7 sm:flex"
              disabled={page === 1}
              onClick={() => setPage(1)}
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={!data || page === data.total_pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden h-7 w-7 sm:flex"
              disabled={!data || page === data.total_pages}
              onClick={() => setPage(data?.total_pages ?? 1)}
            >
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
