import { useState, useMemo, useEffect } from "react";
import { getPublicConfig } from "@/lib/api-client";
import { ArrowUpDown, Search } from "lucide-react";
import { WidgetFrame } from "./widget-frame";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/admin/badges";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import type { BookingRow } from "./use-dashboard-data";

interface RecentBookingsTableProps {
  data: BookingRow[] | null;
  loading?: boolean;
}

type SortKey = "startTime" | "serviceName" | "status";
type SortDir = "asc" | "desc";

export function RecentBookingsTable({ data, loading = false }: RecentBookingsTableProps) {
  if (!loading && !data) return null;

  return <RecentBookingsTableInner data={data} loading={loading} />;
}

function RecentBookingsTableInner({ data, loading }: RecentBookingsTableProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("startTime");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  const rows = useMemo(() => {
    const source = data ?? [];
    const filtered = query.trim()
      ? source.filter(
          (r) =>
            (r.serviceName?.toLowerCase().includes(query.toLowerCase()) ?? false) ||
            (r.clientEmail?.toLowerCase().includes(query.toLowerCase()) ?? false) ||
            (r.staffName?.toLowerCase().includes(query.toLowerCase()) ?? false) ||
            r.status.toLowerCase().includes(query.toLowerCase()),
        )
      : source;

    return [...filtered].sort((a, b) => {
      const av =
        sortKey === "startTime"
          ? a.startTime
          : sortKey === "serviceName"
            ? (a.serviceName ?? "")
            : a.status;
      const bv =
        sortKey === "startTime"
          ? b.startTime
          : sortKey === "serviceName"
            ? (b.serviceName ?? "")
            : b.status;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <WidgetFrame
      title="Upcoming Bookings"
      description="Next scheduled appointments — sortable and filterable"
      loading={loading}
      headerAction={
        <div className="relative w-44">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      }
    >
      <ScrollArea className="h-[280px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 gap-1 text-xs font-medium"
                  onClick={() => toggleSort("serviceName")}
                >
                  Service
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead className="hidden sm:table-cell">Client</TableHead>
              <TableHead className="hidden md:table-cell">Staff</TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 gap-1 text-xs font-medium"
                  onClick={() => toggleSort("startTime")}
                >
                  Time
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 h-7 gap-1 text-xs font-medium"
                  onClick={() => toggleSort("status")}
                >
                  Status
                  <ArrowUpDown className="h-3 w-3" />
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {query ? "No bookings match your filter." : "No upcoming bookings."}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-accent/50"
                  onClick={() => void navigate(`/admin/bookings/${row.id}`)}
                >
                  <TableCell className="text-sm font-medium">
                    {row.serviceName ?? `#${row.id.slice(0, 8)}`}
                  </TableCell>
                  <TableCell className="hidden max-w-[140px] truncate text-sm text-muted-foreground sm:table-cell">
                    {row.clientEmail ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {row.staffName ?? "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {row.startTime
                      ? new Date(row.startTime).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: timezone,
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>
    </WidgetFrame>
  );
}
