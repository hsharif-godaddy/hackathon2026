import { getDay, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar as ShadcnCalendar } from "@/components/ui/calendar";

interface CalendarProps {
  selectedDate: Date | null;
  onSelectDate: (date: Date) => void;
  /** Working days as date-fns getDay() values: 0=Sun … 6=Sat */
  workingDays: number[];
  className?: string;
}

export function Calendar({ selectedDate, onSelectDate, workingDays, className }: CalendarProps) {
  const today = startOfDay(new Date());

  function isDisabled(date: Date): boolean {
    return date < today || !workingDays.includes(getDay(date));
  }

  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium text-foreground">Select a date</p>
      <ShadcnCalendar
        mode="single"
        selected={selectedDate ?? undefined}
        onSelect={(date) => date && onSelectDate(date)}
        disabled={isDisabled}
        className="w-full rounded-xl border border-border shadow-sm"
      />
      <p className="text-center text-xs text-muted-foreground">
        Only available dates are selectable.
      </p>
    </div>
  );
}
