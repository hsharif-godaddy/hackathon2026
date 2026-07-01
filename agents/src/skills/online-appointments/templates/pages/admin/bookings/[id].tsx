import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CreditCard, Trash2 } from "lucide-react";
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
}

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
  unpaid: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
  cancelled: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

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

  return (
    <div className="max-w-2xl space-y-6">
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
            {booking.status}
          </span>
        </div>
      </div>

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
        <Row label="Booker" value={`${booking.bookerType} #${booking.bookerId}`} />
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
        {booking.serviceCost && (
          <Row
            label="Final Price"
            value={
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {formatCost(
                  String(
                    parseFloat(booking.serviceCost) -
                    (booking.discountAmount ? parseFloat(booking.discountAmount) : 0)
                  ),
                  currency,
                )}
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
