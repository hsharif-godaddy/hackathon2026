import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { getPublicConfig } from "@/lib/api-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CalendarCheck } from "lucide-react";

interface ClientDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  notes: string | null;
  createdAt: string;
}

interface Booking {
  id: string;
  uniqueId: string;
  status: string;
  startTime: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value ?? "—"}</span>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  unpaid: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

export default function AdminClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    async function load() {
      const [cRes, bRes] = await Promise.all([
        adminFetch(`/api/appointments/admin/clients/${id}`, token),
        adminFetch(`/api/appointments/admin/clients/${id}/bookings?per_page=10`, token),
      ]);
      if (cRes.ok) {
        const d = (await cRes.json()) as { client?: ClientDetail } & ClientDetail;
        setClient(d.client ?? d);
      }
      if (bRes.ok) {
        const d = (await bRes.json()) as { results?: Booking[]; data?: Booking[] };
        setBookings(d.results ?? d.data ?? []);
      }
      setLoading(false);
    }
    void load();
  }, [id, token]);

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Client not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => void navigate("/admin/clients")}>
          Back to clients
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => void navigate("/admin/clients")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {[client.firstName, client.lastName].filter(Boolean).join(" ") || "Unknown Client"}
          </h1>
          <p className="text-sm text-muted-foreground">Client #{client.id}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold text-foreground">Profile</h2>
        <Row label="First Name" value={client.firstName} />
        <Row label="Last Name" value={client.lastName} />
        <Row
          label="Member since"
          value={
            client.createdAt
              ? new Date(client.createdAt).toLocaleDateString([], {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : "—"
          }
        />
        {client.notes && <Row label="Notes" value={client.notes} />}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border p-5">
          <CalendarCheck className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-semibold text-foreground">Recent Bookings</h2>
        </div>
        <div className="divide-y divide-border">
          {bookings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No bookings</p>
          ) : (
            bookings.map((b) => (
              <div
                key={b.id}
                className="flex cursor-pointer items-center justify-between px-5 py-3 transition-colors hover:bg-accent/50"
                onClick={() => void navigate(`/admin/bookings/${b.id}`)}
              >
                <div>
                  <p className="text-sm font-medium text-foreground">#{b.uniqueId.slice(0, 8)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
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
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    STATUS_COLORS[b.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {b.status}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
