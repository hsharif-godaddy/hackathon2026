import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CreditCard, Trash2, Clock, Tag, User } from "lucide-react";
import { getPublicConfig } from "@/lib/api-client";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { formatCost } from "@/components/booking/service-utils";

interface BookingDetail {
  id: string;
  confirmationCode: string | null;
  status: string;
  startTime: string;
  endTime: string;
  quantity: number;
  bookerId: number;
  bookerType: string;
  paidAmount?: string;
  serviceCost?: string;
  couponCode?: string;
  discountAmount?: string;
  serviceName?: string | null;
  serviceDuration?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  staffName?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  unpaid: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function fromIsoDuration(iso: string | null | undefined): string | null {
  if (!iso) return null;
  if (!iso.startsWith("PT")) return null;
  const hourMatch = iso.match(/(\d+)H/);
  const minuteMatch = iso.match(/(\d+)M/);
  const hours = parseInt(hourMatch?.[1] ?? "0");
  const mins = parseInt(minuteMatch?.[1] ?? "0");
  const total = hours * 60 + mins;
  return total > 0 ? `${total} min` : null;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function AdminBookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAdminAuth();
  const { currency } = useAppConfig();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/appointments/admin/bookings/${id}`, token);
      if (res.ok) {
        const d = (await res.json()) as { booking?: BookingDetail } & BookingDetail;
        setBooking(d.booking ?? d);
      } else {
        setError("Booking not found");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  async function markAsPaid() {
    setActionLoading(true);
    const res = await adminFetch(`/api/appointments/admin/bookings/${id}/mark-as-paid`, token, {
      method: "PATCH",
    });
    if (res.ok) await load();
    setActionLoading(false);
  }

  async function updateStatus(status: string) {
    setActionLoading(true);
    const res = await adminFetch(`/api/appointments/admin/bookings/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (res.ok) await load();
    setActionLoading(false);
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">{error ?? "Booking not found"}</p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => {
            void navigate("/admin/bookings");
          }}
        >
          Back to bookings
        </Button>
      </div>
    );
  }

  const statusLabel =
    booking.status.charAt(0).toUpperCase() + booking.status.slice(1);
  const clientDisplayName = booking.clientName ?? (booking.bookerType === "Client" ? "Guest" : booking.bookerType);
  const clientInitial = clientDisplayName.charAt(0).toUpperCase();
  const durationLabel = fromIsoDuration(booking.serviceDuration);
  const finalPrice = booking.serviceCost
    ? String(
        parseFloat(booking.serviceCost) -
          (booking.discountAmount ? parseFloat(booking.discountAmount) : 0),
      )
    : null;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void navigate("/admin/bookings");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Booking #{booking.confirmationCode ?? booking.id.slice(0, 8)}
          </h1>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              STATUS_COLORS[booking.status] ?? "bg-muted text-muted-foreground",
            )}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Service card */}
      {booking.serviceName && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 font-semibold text-foreground">Service</h2>
          <p className="mb-3 text-base font-medium text-foreground">{booking.serviceName}</p>
          <div className="flex flex-wrap gap-2">
            {booking.serviceCost && (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <Tag className="h-3 w-3" />
                {formatCost(booking.serviceCost, currency)}
              </span>
            )}
            {durationLabel && (
              <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground">
                <Clock className="h-3 w-3" />
                {durationLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Client card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold text-foreground">Client</h2>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {clientInitial}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{clientDisplayName}</p>
            {booking.clientEmail && (
              <p className="text-xs text-muted-foreground">{booking.clientEmail}</p>
            )}
          </div>
        </div>
      </div>

      {/* Booking details */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold text-foreground">Details</h2>
        <Row
          label="Date"
          value={
            booking.startTime
              ? new Date(booking.startTime).toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: timezone,
                })
              : "—"
          }
        />
        <Row
          label="Time"
          value={
            booking.startTime
              ? new Date(booking.startTime).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timezone,
                })
              : "—"
          }
        />
        <Row
          label="End Time"
          value={
            booking.endTime
              ? new Date(booking.endTime).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timezone,
                })
              : "—"
          }
        />
        <Row label="Quantity" value={booking.quantity} />
        {booking.staffName && (
          <Row
            label="Staff"
            value={
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                {booking.staffName}
              </span>
            }
          />
        )}
        {booking.serviceCost && (
          <Row label="Service Cost" value={formatCost(booking.serviceCost, currency)} />
        )}
        {booking.couponCode && (
          <>
            <Row
              label="Coupon Applied"
              value={
                <span className="rounded bg-green-100 px-2 py-1 font-mono text-xs text-green-700 dark:bg-green-900 dark:text-green-300">
                  {booking.couponCode}
                </span>
              }
            />
            {booking.discountAmount && parseFloat(booking.discountAmount) > 0 && (
              <Row
                label="Discount"
                value={
                  <span className="font-medium text-green-600 dark:text-green-400">
                    -{formatCost(booking.discountAmount, currency)}
                  </span>
                }
              />
            )}
          </>
        )}
        {finalPrice !== null && (
          <Row
            label="Final Price"
            value={
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {formatCost(finalPrice, currency)}
              </span>
            }
          />
        )}
        <Row
          label="Confirmation Code"
          value={
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {booking.confirmationCode ?? booking.id.slice(0, 8)}
            </span>
          }
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {booking.status === "unpaid" && (
          <Button
            onClick={() => {
              void markAsPaid();
            }}
            disabled={actionLoading}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Mark as Paid
          </Button>
        )}
        {booking.status !== "cancelled" && (
          <Button
            variant="outline"
            onClick={() => {
              void updateStatus("cancelled");
            }}
            disabled={actionLoading}
            className="border-destructive/20 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Cancel Booking
          </Button>
        )}
      </div>
    </div>
  );
}
