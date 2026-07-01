import { Users } from "lucide-react";
import { WidgetFrame } from "./widget-frame";

interface TotalClientsWidgetProps {
  count: number | null;
  loading?: boolean;
}

export function TotalClientsWidget({ count, loading = false }: TotalClientsWidgetProps) {
  if (!loading && !count) return null;

  return (
    <WidgetFrame
      title="Total Clients"
      description="Registered clients in your system"
      loading={loading}
    >
      <div className="flex items-center gap-4 pt-2">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums text-foreground">
            {count?.toLocaleString() ?? "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">clients total</p>
        </div>
      </div>
    </WidgetFrame>
  );
}
