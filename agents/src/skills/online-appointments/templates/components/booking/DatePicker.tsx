import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, isBefore, startOfDay } from "date-fns";
import { Loader2 } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getAvailableDates, type Service } from "@/lib/api-client";

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

interface DatePickerProps {
  serviceId: string;
  service?: Service;
  timezone: string;
  selectedDate: Date | undefined;
  onSelect: (date: Date) => void;
}

const PRESETS = [
  { label: "Today", value: 0 },
  { label: "Tomorrow", value: 1 },
  { label: "In 3 days", value: 3 },
  { label: "In a week", value: 7 },
  { label: "In 2 weeks", value: 14 },
];

export function DatePicker({
  serviceId,
  service,
  timezone,
  selectedDate,
  onSelect,
}: DatePickerProps) {
  const isOneTime = service?.recurrenceType === "one_time";
  const eventDate = isOneTime
    ? toDateKey(new TZDate(new Date(service.startTime ?? ""), timezone))
    : null;

  const [availableDates, setAvailableDates] = useState<Set<string>>(() =>
    eventDate ? new Set([eventDate]) : new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const fetchedMonths = useRef<Set<string>>(new Set());

  const fetchMonthDates = useCallback(
    async (year: number, month: number) => {
      if (isOneTime) return;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (fetchedMonths.current.has(key)) return;
      fetchedMonths.current.add(key);

      const lastDay = new Date(year, month, 0).getDate();
      const start = new TZDate(year, month - 1, 1, 0, 0, 0, timezone).toISOString();
      const end = new TZDate(year, month - 1, lastDay, 23, 59, 59, timezone).toISOString();

      setLoading(true);
      try {
        const data = await getAvailableDates(serviceId, start, end);
        const dates = (data.available_dates as Array<{ available: boolean; date: string }>)
          .filter((d) => d.available)
          .map((d) => d.date);
        setAvailableDates((prev) => new Set([...prev, ...dates]));
      } catch {
        // unavailable dates remain disabled
      } finally {
        setLoading(false);
      }
    },
    [isOneTime, serviceId, timezone],
  );

  useEffect(() => {
    if (isOneTime) return;
    const now = new Date();
    void fetchMonthDates(now.getFullYear(), now.getMonth() + 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    void fetchMonthDates(next.getFullYear(), next.getMonth() + 1);
  }, [serviceId, isOneTime, fetchMonthDates]);

  function handleMonthChange(month: Date) {
    setCurrentMonth(month);
    void fetchMonthDates(month.getFullYear(), month.getMonth() + 1);
  }

  const today = startOfDay(new Date());

  const isDateDisabled = (date: Date) =>
    isBefore(date, today) || !availableDates.has(toDateKey(date));

  function handlePreset(daysFromNow: number) {
    const candidate = addDays(today, daysFromNow);
    if (!isDateDisabled(candidate)) {
      const newMonth = new Date(candidate.getFullYear(), candidate.getMonth(), 1);
      setCurrentMonth(newMonth);
      onSelect(candidate);
    }
  }

  const defaultMonth = isOneTime
    ? new TZDate(new Date(service.startTime ?? ""), timezone)
    : undefined;

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">Select a date</p>
        {loading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Checking availability
          </span>
        )}
      </div>

      <Card className="w-full overflow-hidden p-0">
        <CardContent className="p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            month={currentMonth}
            defaultMonth={defaultMonth}
            onSelect={(date) => date && onSelect(date)}
            onMonthChange={handleMonthChange}
            disabled={isDateDisabled}
            fixedWeeks
            className="w-full p-3 [--cell-size:--spacing(9)]"
            modifiers={{ booked: (date) => !isBefore(date, today) && isDateDisabled(date) }}
            modifiersClassNames={{
              booked: "[&>button]:line-through opacity-100",
            }}
          />
        </CardContent>

        {!isOneTime && (
          <CardFooter className="flex flex-wrap gap-1.5 border-t px-3 py-3">
            {PRESETS.map((preset) => {
              const candidate = addDays(today, preset.value);
              const disabled = isDateDisabled(candidate);
              return (
                <Button
                  key={preset.value}
                  variant={
                    selectedDate && toDateKey(selectedDate) === toDateKey(candidate)
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  className="flex-1 text-xs"
                  disabled={disabled}
                  onClick={() => handlePreset(preset.value)}
                >
                  {preset.label}
                </Button>
              );
            })}
          </CardFooter>
        )}
      </Card>

      {isOneTime && (
        <p className="pt-1 text-center text-xs text-muted-foreground">
          This is a one-time event on a specific date.
        </p>
      )}
    </div>
  );
}
