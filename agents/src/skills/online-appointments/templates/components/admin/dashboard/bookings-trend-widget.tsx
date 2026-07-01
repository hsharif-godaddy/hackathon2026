import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { WidgetFrame } from "./widget-frame";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { TrendDay } from "./use-dashboard-data";

interface BookingsTrendWidgetProps {
  data: TrendDay[] | null;
  loading?: boolean;
}

const chartConfig = {
  bookings: { label: "Bookings", color: "var(--chart-1)" },
  cancelled: { label: "Cancelled", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function BookingsTrendWidget({ data, loading = false }: BookingsTrendWidgetProps) {
  if (!loading && !data) return null;

  return (
    <WidgetFrame
      title="Booking Trend"
      description="Daily bookings over the last 30 days"
      loading={loading}
    >
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <AreaChart data={data ?? []} margin={{ left: -16, right: 4, top: 4 }}>
          <defs>
            <linearGradient id="fillBookings" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-bookings)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-bookings)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillCancelled" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-cancelled)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-cancelled)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={28}
            tickFormatter={(v: string) =>
              new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
          />
          <YAxis tickLine={false} axisLine={false} tickMargin={4} width={32} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(v) =>
                  new Date(v as string).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
            }
          />
          <Area
            type="monotone"
            dataKey="bookings"
            stroke="var(--color-bookings)"
            fill="url(#fillBookings)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="cancelled"
            stroke="var(--color-cancelled)"
            fill="url(#fillCancelled)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        </AreaChart>
      </ChartContainer>
    </WidgetFrame>
  );
}
