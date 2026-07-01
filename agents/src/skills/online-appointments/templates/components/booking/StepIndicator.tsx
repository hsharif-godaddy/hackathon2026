import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/contexts/AppConfigContext";

export type BookingStep = "date" | "time" | "details" | "confirmation";

const STEP_IDS: BookingStep[] = ["date", "time", "details", "confirmation"];

interface StepIndicatorProps {
  current: BookingStep;
  /** Override step labels. Defaults come from AppConfig.booking.steps. */
  labels?: [string, string, string, string];
}

export function StepIndicator({ current, labels }: StepIndicatorProps) {
  const { booking } = useAppConfig();
  const stepLabels = labels ?? booking.steps;
  const currentIdx = STEP_IDS.indexOf(current);

  return (
    <div className="mb-8 flex select-none items-center justify-center gap-0">
      {STEP_IDS.map((id, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;

        return (
          <div key={id} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-all duration-200",
                  done
                    ? "bg-foreground text-background"
                    : active
                      ? "border-2 border-foreground text-foreground"
                      : "border-2 border-border text-muted-foreground",
                )}
              >
                {done ? <Check size={14} strokeWidth={2.5} /> : idx + 1}
              </div>
              <span
                className={cn(
                  "text-xs tracking-wide",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {stepLabels[idx]}
              </span>
            </div>
            {idx < STEP_IDS.length - 1 && (
              <div
                className={cn(
                  "mx-2 mb-5 h-px w-10 transition-colors duration-200",
                  idx < currentIdx ? "bg-foreground" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
