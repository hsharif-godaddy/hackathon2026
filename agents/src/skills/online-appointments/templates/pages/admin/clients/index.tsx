import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

interface Client {
  id: string;
  firstName: string | null;
  lastName: string | null;
  contact?: { email: string | null; phone_number: string | null } | null;
}

interface PaginatedResponse {
  results: Client[];
  total_count: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export default function AdminClientsPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(p: number, q: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), per_page: "20" });
      if (q) params.set("search", q);
      const res = await adminFetch(`/api/appointments/admin/clients?${params}`, token);
      if (res.ok) setData((await res.json()) as PaginatedResponse);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(page, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load is not memoized; search triggers via debounced handleSearch
  }, [page, token]);

  function handleSearch(val: string) {
    setSearch(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      void load(1, val);
    }, 300);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Clients</h1>
        <p className="mt-1 text-sm text-muted-foreground">{data?.total_count ?? 0} clients</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name…"
          className="pl-9"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Phone</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td colSpan={4} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : data?.results.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-muted-foreground">
                  No clients found
                </td>
              </tr>
            ) : (
              data?.results.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => void navigate(`/admin/clients/${c.id}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {(c.firstName?.[0] ?? c.lastName?.[0] ?? "?").toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">
                        {[c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown"}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.contact?.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.contact?.phone_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-muted px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Page {data.page} of {data.total_pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === data.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
