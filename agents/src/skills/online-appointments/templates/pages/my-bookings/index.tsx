import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LogOut, CalendarCheck, ChevronRight, AlertCircle } from "lucide-react";
import { getPublicConfig } from "@/lib/api-client";

interface Booking {
  id: string;
  uniqueId: string;
  status: string;
  startTime: string;
  service?: { name: string | null; cost: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  unpaid: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function NotAuthenticatedView() {
  return (
    <div className="flex min-h-[80vh] items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <CalendarCheck className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to view and manage your appointments
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link to="/login?redirect=/my-bookings">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function BookingsList({
  clientId,
  displayName,
  email,
  onLogout,
}: {
  clientId: number;
  displayName: string | null;
  email: string | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    void fetch(
      `/api/appointments/customer/my-bookings?client_id=${clientId}&tab=${tab}&per_page=20`,
    )
      .then((r) => r.json() as Promise<{ results?: Booking[] }>)
      .then((d) => setBookings(d.results ?? []))
      .finally(() => setLoading(false));
  }, [clientId, tab]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Bookings</h1>
            <p className="text-sm text-muted-foreground">
              {displayName ? `Welcome back, ${displayName}!` : email}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            <LogOut className="mr-1.5 h-4 w-4" />
            Sign out
          </Button>
        </div>

        <div className="flex gap-2">
          {(["upcoming", "past"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                tab === t
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))
          ) : bookings.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <CalendarCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No {tab} bookings</p>
              {tab === "upcoming" && (
                <Button className="mt-4" size="sm" onClick={() => void navigate("/")}>
                  Book an appointment
                </Button>
              )}
            </div>
          ) : (
            bookings.map((b) => (
              <div
                key={b.id}
                className={cn(
                  "flex items-center justify-between rounded-xl border border-border bg-card p-4",
                  "cursor-pointer transition-colors hover:border-border/80",
                )}
                onClick={() => void navigate(`/my-bookings/${b.id}?client_id=${clientId}`)}
              >
                <div>
                  <p className="font-medium text-foreground">
                    {b.service?.name ?? `Booking #${b.uniqueId.slice(0, 8)}`}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {b.startTime
                      ? new Date(b.startTime).toLocaleString([], {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: timezone,
                        })
                      : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      STATUS_COLORS[b.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {b.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function MyBookingsPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated || !user) {
    return <NotAuthenticatedView />;
  }

  if (user.identityType !== "Client") {
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm">This page is for customers only.</p>
        </div>
      </div>
    );
  }

  return (
    <BookingsList
      clientId={user.identityId}
      displayName={user.displayName}
      email={user.email}
      onLogout={() => void logout()}
    />
  );
}
