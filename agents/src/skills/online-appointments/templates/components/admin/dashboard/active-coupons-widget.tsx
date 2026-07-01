import { Tag } from "lucide-react";
import { format } from "date-fns";
import { WidgetFrame } from "./widget-frame";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import type { ActiveCoupon } from "./use-dashboard-data";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { formatCost } from "@/components/booking/service-utils";

interface ActiveCouponsWidgetProps {
  data: ActiveCoupon[] | null;
  loading?: boolean;
}

export function ActiveCouponsWidget({ data, loading = false }: ActiveCouponsWidgetProps) {
  const { currency } = useAppConfig();
  if (!loading && !data) return null;

  return (
    <WidgetFrame
      title="Active Coupons"
      description="Discount codes currently redeemable"
      loading={loading}
      headerAction={
        data && (
          <Badge variant="secondary" className="tabular-nums">
            {data.length}
          </Badge>
        )
      }
    >
      <ScrollArea className="h-[220px]">
        <div className="space-y-3 pt-1">
          {(data ?? []).map((c) => {
            const usagePct =
              c.limit !== null && c.limit > 0
                ? Math.min(100, Math.round(((c.currentUsage ?? 0) / c.limit) * 100))
                : null;
            const discount =
              c.type === "PERCENTAGE"
                ? `${c.discountPercentage ?? 0}% off`
                : `${formatCost(String((c.discountPrice ?? 0) / 100), currency)} off`;

            return (
              <div
                key={c.id}
                className="space-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Tag className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="truncate font-mono text-sm font-semibold tracking-wide">
                      {c.code}
                    </span>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {discount}
                  </Badge>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Expires {format(new Date(c.endDate), "MMM d, yyyy")}</span>
                  {c.limit !== null ? (
                    <span>
                      {c.currentUsage ?? 0} / {c.limit} uses
                    </span>
                  ) : (
                    <span>{c.currentUsage ?? 0} uses</span>
                  )}
                </div>
                {usagePct !== null && <Progress value={usagePct} className="h-1" />}
              </div>
            );
          })}
          {(data ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Tag className="mb-2 h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No active coupons</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </WidgetFrame>
  );
}
