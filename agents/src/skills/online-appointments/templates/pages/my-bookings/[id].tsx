import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft, CalendarDays, Clock } from "lucide-react";
import { getPublicConfig } from "@/lib/api-client";

interface Addon {
  id: string;
  title: string;
  price: string;
  duration: string;
}

interface BookingDetail {
  id: string;
  uniqueId: string;
  status: string;
  startTime: string;
  endTime: string;
  quantity: number;
  service?: { name: string | null; cost: string | null; duration: string | null } | null;
  answers?: Array<{ id: string; body: string; questionLabel: string | null }>;
  addons?: Addon[];
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  unpaid: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value ?? "—"}</span>
    </div>
  );
}

export default function MyBookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const clientId = searchParams.get("client_id");
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!clientId) {
      void navigate("/my-bookings");
      return;
    }
    void fetch(`/api/appointments/customer/my-bookings/${id}?client_id=${clientId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load booking"))))
      .then(setBooking)
      .catch(() => void navigate("/my-bookings"))
      .finally(() => setLoading(false));
  }, [id, clientId, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-muted p-4 sm:p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!booking) return null;

  return (
    <div className="min-h-screen bg-muted p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => void navigate("/my-bookings")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {booking.service?.name ?? `Booking #${booking.uniqueId.slice(0, 8)}`}
            </h1>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                STATUS_COLORS[booking.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {booking.status}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex gap-6 border-b border-border pb-4">
            <div className="flex items-center gap-2 text-foreground">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {booking.startTime
                  ? new Date(booking.startTime).toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                      timeZone: timezone,
                    })
                  : "—"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {booking.startTime
                  ? new Date(booking.startTime).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: timezone,
                    })
                  : "—"}
                {" – "}
                {booking.endTime
                  ? new Date(booking.endTime).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: timezone,
                    })
                  : ""}
              </span>
            </div>
          </div>

          <Row
            label="Booking reference"
            value={<span className="font-mono text-xs">{booking.uniqueId}</span>}
          />
          <Row label="Quantity" value={booking.quantity} />
          {booking.service?.cost && <Row label="Service" value={`$${booking.service.cost}`} />}
          {booking.addons && booking.addons.length > 0 && (
            <>
              {booking.addons.map((addon) => (
                <Row key={addon.id} label={`+ ${addon.title}`} value={`$${addon.price}`} />
              ))}
            </>
          )}
          {booking.service?.cost && booking.addons && booking.addons.length > 0 && (
            <Row
              label="Total"
              value={
                <span className="font-semibold">
                  $
                  {(
                    parseFloat(booking.service.cost) +
                    booking.addons.reduce((sum, addon) => sum + parseFloat(addon.price), 0)
                  ).toFixed(2)}
                </span>
              }
            />
          )}
        </div>

        {booking.answers && booking.answers.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 font-semibold text-foreground">Your Answers</h2>
            <div className="space-y-3">
              {booking.answers.map((a) => (
                <div key={a.id}>
                  <p className="text-xs text-muted-foreground">{a.questionLabel ?? "Question"}</p>
                  <p className="mt-0.5 text-sm text-foreground">{a.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={() => void navigate("/")}>
          Book another appointment
        </Button>
      </div>
    </div>
  );
}
