import { Clock } from "lucide-react";
import { format } from "date-fns";
import { WidgetFrame } from "./widget-frame";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { DayHours } from "./use-dashboard-data";

interface TodayAvailabilityWidgetProps {
  data: DayHours | null;
  loading?: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseTime(t: string): Date {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d;
}

export function TodayAvailabilityWidget({ data, loading = false }: TodayAvailabilityWidgetProps) {
  if (!loading && !data) return null;

  const today = new Date();
  const dayName = DAY_NAMES[today.getDay()];

  return (
    <WidgetFrame
      title="Today's Hours"
      description={`${dayName}, ${format(today, "MMMM d")}`}
      loading={loading}
      headerAction={
        data && (
          <Badge variant={data.active ? "default" : "secondary"} className="text-xs">
            {data.active ? "Open" : "Closed"}
          </Badge>
        )
      }
    >
      <div className="space-y-3 pt-1">
        {!data?.active ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Clock className="mb-2 h-6 w-6 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Closed today</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.timeBlocks.map((block, idx) => {
              const start = parseTime(block.startTime);
              const end = parseTime(block.endTime);
              const now = new Date();
              const isActive = now >= start && now <= end;
              return (
                <div key={`${block.startTime}-${block.endTime}`}>
                  {idx > 0 && <Separator className="my-2" />}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium tabular-nums">
                        {format(start, "h:mm a")} – {format(end, "h:mm a")}
                      </span>
                    </div>
                    {isActive && (
                      <Badge
                        variant="outline"
                        className="border-green-300 text-xs text-green-600 dark:text-green-400"
                      >
                        Now open
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WidgetFrame>
  );
}
