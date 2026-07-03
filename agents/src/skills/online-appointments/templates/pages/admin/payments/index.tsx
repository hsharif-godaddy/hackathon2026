import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, RefreshCw } from "lucide-react";
import { format } from "date-fns";

interface Transaction {
  id: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  transactionId: string | null;
  paymentMethod: string | null;
  createdAt: string;
  bookingId: string;
  clientFirstName: string | null;
  clientLastName: string | null;
  serviceName: string | null;
}

interface PaginatedResponse {
  results: Transaction[];
  total_count: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const STATUS_CLASS: Record<string, string> = {
  succeeded:
    "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900",
  pending:
    "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
  expired:
    "bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-400 dark:border-zinc-800",
};

const STATUSES = ["all", "succeeded", "pending", "expired"] as const;
const PAGE_SIZES = [10, 15, 25, 50];

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
}

function clientName(t: Transaction) {
  if (t.clientFirstName || t.clientLastName) {
    return [t.clientFirstName, t.clientLastName].filter(Boolean).join(" ");
  }
  return null;
}

export default function AdminPaymentsPage() {
  const { token } = useAdminAuth();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(15);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await adminFetch(`/api/appointments/admin/payments/transactions?${params}`, token);
      if (res.ok) setData((await res.json()) as PaginatedResponse);
    } finally {
      setLoading(false);
    }
  }, [page, perPage, statusFilter, token]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    setPage(1);
  }

  const colCount = 8;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.total_count ?? 0} total transactions
          </p>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <Tabs value={statusFilter} onValueChange={handleStatusChange}>
            <TabsList className="h-9">
              {STATUSES.map((s) => (
                <TabsTrigger key={s} value={s} className="px-3 text-xs capitalize">
                  {s === "all" ? "All" : s}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Date & Time
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Transaction ID
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Service</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Provider</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Method</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
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
              ) : !data?.results.length ? (
                <tr>
                  <td
                    colSpan={colCount}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No transactions found
                  </td>
                </tr>
              ) : (
                data.results.map((t) => (
                  <tr key={t.id} className="transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3 text-foreground">
                      {t.createdAt ? format(new Date(t.createdAt), "MMM d, yyyy h:mm a") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {t.transactionId ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default font-mono text-xs text-muted-foreground">
                              {t.transactionId.slice(0, 12)}…
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="font-mono text-xs">{t.transactionId}</p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{clientName(t) ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{t.serviceName ?? "—"}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatAmount(t.amount, t.currency)}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">{t.provider}</td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {t.paymentMethod ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        className={cn("text-xs capitalize", STATUS_CLASS[t.status])}
                      >
                        {t.status}
                      </Badge>
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
    </TooltipProvider>
  );
}
