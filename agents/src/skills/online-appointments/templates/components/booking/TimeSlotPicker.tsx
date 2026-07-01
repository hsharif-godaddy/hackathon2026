import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAvailabilityTimes } from "@/lib/api-client";
import { formatSlotTime, formatFullDate, getHourInTimezone } from "./slot-utils";

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface AvailabilitySlot {
  available: boolean;
  start_time: string;
  end_time: string;
  remaining_capacity: number | null;
}

interface TimeSlotPickerProps {
  serviceId: string;
  date: Date;
  selectedTime: string | undefined;
  onSelect: (time: string) => void;
  onChangeDate: () => void;
  timezone?: string;
}

export function TimeSlotPicker({
  serviceId,
  date,
  selectedTime,
  onSelect,
  onChangeDate,
  timezone,
}: TimeSlotPickerProps) {
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAvailabilityTimes(serviceId, toDateKey(date))
      .then((data) => setSlots(data.availability_times.filter((s) => s.available)))
      .catch(() => setError("Failed to load time slots."))
      .finally(() => setLoading(false));
  }, [serviceId, date]);

  const { am, pm } = useMemo(() => {
    const am: AvailabilitySlot[] = [];
    const pm: AvailabilitySlot[] = [];
    for (const slot of slots) {
      const hour = getHourInTimezone(slot.start_time, timezone);
      (hour < 12 ? am : pm).push(slot);
    }
    return { am, pm };
  }, [slots, timezone]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-4 w-16" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 6 }, (_, i) => `slot-sk-${i}`).map((k) => (
            <Skeleton key={k} className="h-14 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={onChangeDate}>
          Try another date
        </Button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium text-foreground">No availability on this date</p>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          All slots are full or unavailable.
        </p>
        <Button variant="outline" size="sm" onClick={onChangeDate}>
          Choose another date
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{formatFullDate(date)}</p>
        <button
          onClick={onChangeDate}
          className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
        >
          Change date
        </button>
      </div>

      <div className="space-y-4">
        {am.length > 0 && (
          <SlotGroup
            label="Morning"
            slots={am}
            selectedTime={selectedTime}
            onSelect={onSelect}
            timezone={timezone}
          />
        )}
        {pm.length > 0 && (
          <SlotGroup
            label="Afternoon & Evening"
            slots={pm}
            selectedTime={selectedTime}
            onSelect={onSelect}
            timezone={timezone}
          />
        )}
      </div>

      {timezone && (
        <p className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <Clock size={11} />
          {timezone.replace(/_/g, " ")}
        </p>
      )}
    </div>
  );
}

interface SlotGroupProps {
  label: string;
  slots: AvailabilitySlot[];
  selectedTime: string | undefined;
  onSelect: (time: string) => void;
  timezone?: string;
}

function CapacityBadge({ remaining }: { remaining: number | null }) {
  if (remaining === null || remaining <= 1 || remaining > 5) return null;
  if (remaining <= 3) {
    return (
      <Badge variant="destructive" className="mt-1 px-1.5 py-0 text-[10px]">
        {remaining} spots left
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="mt-1 px-1.5 py-0 text-[10px]">
      {remaining} spots
    </Badge>
  );
}

function SlotGroup({ label, slots, selectedTime, onSelect, timezone }: SlotGroupProps) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {slots.map((slot) => {
          const isSelected = selectedTime === slot.start_time;
          return (
            <button
              key={slot.start_time}
              onClick={() => onSelect(slot.start_time)}
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-150",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-accent",
              )}
            >
              <span className="flex items-center gap-1.5">
                <Clock
                  size={12}
                  className={cn(
                    "shrink-0",
                    isSelected ? "text-primary-foreground/70" : "text-muted-foreground",
                  )}
                />
                {formatSlotTime(slot.start_time, timezone)}
              </span>
              <CapacityBadge remaining={slot.remaining_capacity} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
