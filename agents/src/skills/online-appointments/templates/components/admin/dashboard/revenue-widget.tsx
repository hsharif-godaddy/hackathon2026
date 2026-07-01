import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { WidgetFrame } from "./widget-frame";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { RevenueDay } from "./use-dashboard-data";
import { useAppConfig } from "@/contexts/AppConfigContext";

interface RevenueWidgetProps {
  data: RevenueDay[] | null;
  loading?: boolean;
}

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

function fmtRevenue(major: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(major);
}

export function RevenueWidget({ data, loading = false }: RevenueWidgetProps) {
  const { currency } = useAppConfig();
  if (!loading && !data) return null;

  const total = (data ?? []).reduce((s, d) => s + d.revenue, 0);

  return (
    <WidgetFrame
      title="Revenue"
      description={`${fmtRevenue(total, currency)} collected in the last 14 days`}
      loading={loading}
    >
      <ChartContainer config={chartConfig} className="h-[200px] w-full">
        <BarChart data={data ?? []} margin={{ left: -16, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            minTickGap={24}
            tickFormatter={(v: string) =>
              new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={44}
            tickFormatter={(v: number) => fmtRevenue(v, currency)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => [fmtRevenue(value as number, currency), "Revenue"]}
                labelFormatter={(v) =>
                  new Date(v as string).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
            }
          />
          <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </WidgetFrame>
  );
}
