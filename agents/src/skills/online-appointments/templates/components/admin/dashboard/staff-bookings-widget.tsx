import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { WidgetFrame } from "./widget-frame";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { StaffBookingCount } from "./use-dashboard-data";

interface StaffBookingsWidgetProps {
  data: StaffBookingCount[] | null;
  loading?: boolean;
}

const MIN_ITEMS = 3;
const PAD_PREFIX = "__pad_";

function padToMin(
  items: StaffBookingCount[],
): Array<StaffBookingCount | { name: string; bookings: number; fill: string }> {
  const result: Array<StaffBookingCount | { name: string; bookings: number; fill: string }> = [
    ...items,
  ];
  while (result.length < MIN_ITEMS) {
    result.push({ name: `${PAD_PREFIX}${result.length}`, bookings: 0, fill: "var(--muted)" });
  }
  return result;
}

export function StaffBookingsWidget({ data, loading = false }: StaffBookingsWidgetProps) {
  if (!loading && !data) return null;

  const padded = padToMin(data ?? []);
  const chartConfig: ChartConfig = {
    bookings: { label: "Bookings", color: "var(--chart-2)" },
  };

  return (
    <WidgetFrame
      title="Bookings by Staff"
      description="Assignments per staff member in the last 30 days"
      loading={loading}
    >
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart
          accessibilityLayer
          data={padded}
          margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="name"
            tickLine={false}
            tickMargin={8}
            axisLine={false}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: string) => {
              if (v.startsWith(PAD_PREFIX)) return "";
              const parts = v.trim().split(" ");
              return parts.length > 1 ? `${parts[0]} ${parts[1]?.slice(0, 1)}.` : v.slice(0, 8);
            }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={24}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, name) => {
                  if (typeof name === "string" && name.startsWith(PAD_PREFIX)) return null;
                  return [value, "Bookings"];
                }}
              />
            }
          />
          <Bar dataKey="bookings" radius={8}>
            {padded.map((entry) => (
              <Cell
                key={entry.name}
                fill={entry.name.startsWith(PAD_PREFIX) ? "var(--border)" : "var(--chart-2)"}
                fillOpacity={entry.name.startsWith(PAD_PREFIX) ? 0.2 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </WidgetFrame>
  );
}
