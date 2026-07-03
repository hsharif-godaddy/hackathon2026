import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { WidgetFrame } from "./widget-frame";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { ServiceCount } from "./use-dashboard-data";

interface TopServicesWidgetProps {
  data: ServiceCount[] | null;
  loading?: boolean;
}

const MIN_ITEMS = 3;
const PAD_PREFIX = "__pad_";

function padToMin(
  items: ServiceCount[],
): Array<ServiceCount | { name: string; bookings: number; fill: string }> {
  const result: Array<ServiceCount | { name: string; bookings: number; fill: string }> = [...items];
  while (result.length < MIN_ITEMS) {
    result.push({ name: `${PAD_PREFIX}${result.length}`, bookings: 0, fill: "var(--muted)" });
  }
  return result;
}

export function TopServicesWidget({ data, loading = false }: TopServicesWidgetProps) {
  if (!loading && !data) return null;

  const padded = padToMin(data ?? []);
  const chartConfig: ChartConfig = {
    bookings: { label: "Bookings", color: "var(--chart-1)" },
  };

  return (
    <WidgetFrame
      title="Top Services"
      description="Most booked services in the last 30 days"
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
              const words = v.split(" ");
              return words.length > 1 ? `${words[0]} ${words[1]?.slice(0, 1)}.` : v.slice(0, 8);
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
                fill={entry.name.startsWith(PAD_PREFIX) ? "var(--border)" : "var(--chart-1)"}
                fillOpacity={entry.name.startsWith(PAD_PREFIX) ? 0.2 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </WidgetFrame>
  );
}
