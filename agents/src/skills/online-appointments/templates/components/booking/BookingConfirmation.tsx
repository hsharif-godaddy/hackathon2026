import type { ElementType, ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { type Booking, type Service } from "@/lib/api-client";

function formatFullDatetime(iso: string, timezone?: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

interface BookingConfirmationProps {
  booking: Booking;
  service: Service;
  timezone?: string;
  onBookAnother: () => void;
  /** Override the success icon. Defaults to CheckCircle2. */
  icon?: ElementType;
  /** Override the success heading. Defaults to AppConfig.booking.confirmationTitle. */
  title?: string;
  /** Override the success description. Defaults to AppConfig.booking.confirmationDescription. */
  description?: string;
  /** Override the "book another" button label. */
  bookAnotherLabel?: string;
  /** Extra className on the root wrapper. */
  className?: string;
}

export function BookingConfirmation({
  booking,
  service,
  timezone,
  onBookAnother,
  icon: Icon = CheckCircle2,
  title,
  description,
  bookAnotherLabel = "Book another appointment",
  className,
}: BookingConfirmationProps) {
  const { booking: bookingConfig } = useAppConfig();

  return (
    <div className={cn("space-y-6 py-4 text-center", className)}>
      <div className="flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-green-100 bg-green-50">
          <Icon size={26} className="text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">
            {title ?? bookingConfig.confirmationTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {description ?? bookingConfig.confirmationDescription}
          </p>
        </div>
      </div>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card text-left text-sm">
        <Row label="Service" value={service.name} />
        <Row label="Date & time" value={formatFullDatetime(booking.start_time, timezone)} />
        <Row
          label="Confirmation Code"
          value={
            <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs tracking-wide text-foreground">
              {booking.confirmation_code}
            </span>
          }
        />
        <Row
          label="Status"
          value={
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-xs font-medium capitalize text-amber-700">
              {booking.status}
            </span>
          }
        />
      </div>

      <Button variant="outline" onClick={onBookAnother} className="w-full rounded-xl">
        {bookAnotherLabel}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
