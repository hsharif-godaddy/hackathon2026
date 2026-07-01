import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagsContext";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  useDashboardData,
  type BookingSummary,
  type DashboardData,
} from "@/components/admin/dashboard/use-dashboard-data";
import { SortableWidget } from "@/components/admin/dashboard/sortable-widget";
import { RecentBookingsTable } from "@/components/admin/dashboard/recent-bookings-table";
import { BookingsTrendWidget } from "@/components/admin/dashboard/bookings-trend-widget";
import { RevenueWidget } from "@/components/admin/dashboard/revenue-widget";
import { TopServicesWidget } from "@/components/admin/dashboard/top-services-widget";
import { StaffBookingsWidget } from "@/components/admin/dashboard/staff-bookings-widget";
import { ActiveStaffWidget } from "@/components/admin/dashboard/active-staff-widget";
import { ActiveCouponsWidget } from "@/components/admin/dashboard/active-coupons-widget";
import { TodayAvailabilityWidget } from "@/components/admin/dashboard/today-availability-widget";
import { TotalClientsWidget } from "@/components/admin/dashboard/total-clients-widget";

// ─── Stat card IDs ───────────────────────────────────────────────────────────

const STAT_IDS = [
  "stat_total_bookings",
  "stat_revenue",
  "stat_awaiting",
  "stat_cancellations",
] as const;
type StatId = (typeof STAT_IDS)[number];

const STAT_STORAGE_KEY = "admin_dashboard_stat_order";

function loadStatOrder(): StatId[] {
  try {
    const raw = localStorage.getItem(STAT_STORAGE_KEY);
    if (!raw) return [...STAT_IDS];
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((id) => (STAT_IDS as readonly string[]).includes(id)) as StatId[];
    const missing = STAT_IDS.filter((id) => !valid.includes(id));
    return [...valid, ...missing];
  } catch {
    return [...STAT_IDS];
  }
}

// ─── Main widget IDs (includes upcoming bookings as full-width) ───────────────

const WIDGET_IDS = [
  "upcoming_bookings",
  "bookings_trend",
  "revenue_chart",
  "top_services",
  "staff_bookings",
  "active_staff",
  "active_coupons",
  "today_availability",
  "total_clients",
] as const;

type WidgetId = (typeof WIDGET_IDS)[number];

const WIDGET_STORAGE_KEY = "admin_dashboard_widget_order";

/** Widgets that always span both columns */
const FULL_WIDTH_WIDGETS = new Set<WidgetId>(["upcoming_bookings"]);

function loadWidgetOrder(): WidgetId[] {
  try {
    const raw = localStorage.getItem(WIDGET_STORAGE_KEY);
    if (!raw) return [...WIDGET_IDS];
    const parsed = JSON.parse(raw) as string[];
    const valid = parsed.filter((id) =>
      (WIDGET_IDS as readonly string[]).includes(id),
    ) as WidgetId[];
    const missing = WIDGET_IDS.filter((id) => !valid.includes(id));
    return [...valid, ...missing];
  } catch {
    return [...WIDGET_IDS];
  }
}

const WIDGET_FEATURE_MAP: Record<WidgetId, string> = {
  upcoming_bookings: "admin.dashboard.widgets.recent_bookings_table",
  bookings_trend: "admin.dashboard.widgets.bookings_trend",
  revenue_chart: "admin.dashboard.widgets.revenue_chart",
  top_services: "admin.dashboard.widgets.top_services",
  staff_bookings: "admin.dashboard.widgets.staff_bookings",
  active_staff: "admin.dashboard.widgets.active_staff",
  active_coupons: "admin.dashboard.widgets.active_coupons",
  today_availability: "admin.dashboard.widgets.today_availability",
  total_clients: "admin.dashboard.widgets.total_clients",
};

function widgetHasData(id: WidgetId, dash: DashboardData): boolean {
  if (dash.loading) return true;
  switch (id) {
    case "upcoming_bookings":
      return !!dash.upcomingBookings;
    case "bookings_trend":
      return !!dash.bookingsTrend;
    case "revenue_chart":
      return !!dash.revenueByDay;
    case "top_services":
      return !!dash.topServices;
    case "staff_bookings":
      return !!dash.staffBookings;
    case "active_staff":
      return !!dash.staffList;
    case "active_coupons":
      return !!dash.activeCoupons;
    case "today_availability":
      return !!dash.todayAvailability;
    case "total_clients":
      return !!dash.totalClients;
  }
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  footerPrimary: string;
  footerSecondary: string;
  loading: boolean;
}

function StatCard({
  label,
  value,
  trend = "neutral",
  trendLabel,
  footerPrimary,
  footerSecondary,
  loading,
}: StatCardProps) {
  const TrendIcon = trend === "down" ? TrendingDown : TrendingUp;
  const trendClass =
    trend === "up"
      ? "text-green-600 dark:text-green-400"
      : trend === "down"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <Card className="shadow-xs h-full bg-gradient-to-t from-primary/5 to-card dark:bg-card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-bold tabular-nums">
          {loading ? <Skeleton className="h-9 w-24" /> : value}
        </CardTitle>
        {trendLabel && (
            <Badge variant="outline" className={cn("gap-1 font-medium", trendClass)}>
              <TrendIcon className="h-3 w-3" />
              {trendLabel}
            </Badge>
        )}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 pt-3 text-sm">
        <div className={cn("flex items-center gap-1.5 font-medium", trendClass)}>
          {footerPrimary}
          <TrendIcon className="h-4 w-4" />
        </div>
        <div className="text-muted-foreground">{footerSecondary}</div>
      </CardFooter>
    </Card>
  );
}

function buildStatCards(
  summary: BookingSummary | null,
  loading: boolean,
): Record<StatId, StatCardProps> {
  return {
    stat_total_bookings: {
      label: "Total Bookings",
      value: summary?.total ?? 0,
      trend: "up",
      trendLabel: "All time",
      footerPrimary: "Booking activity",
      footerSecondary: "Across all services",
      loading,
    },
    stat_revenue: {
      label: "Revenue Collected",
      value: summary?.paid ?? 0,
      trend: "up",
      trendLabel: "Paid",
      footerPrimary: "Payments confirmed",
      footerSecondary: "Fully settled bookings",
      loading,
    },
    stat_awaiting: {
      label: "Awaiting Payment",
      value: summary?.unpaid ?? 0,
      trend: "neutral",
      trendLabel: "Unpaid",
      footerPrimary: "Needs follow-up",
      footerSecondary: "Outstanding balances",
      loading,
    },
    stat_cancellations: {
      label: "Cancellations",
      value: summary?.cancelled ?? 0,
      trend: "down",
      trendLabel: "Cancelled",
      footerPrimary: "Bookings lost",
      footerSecondary: "Review cancellation reasons",
      loading,
    },
  };
}

// ─── Widget content renderer ──────────────────────────────────────────────────

function WidgetContent({ id, dash }: { id: WidgetId; dash: DashboardData }) {
  switch (id) {
    case "upcoming_bookings":
      return <RecentBookingsTable data={dash.upcomingBookings} loading={dash.loading} />;
    case "bookings_trend":
      return <BookingsTrendWidget data={dash.bookingsTrend} loading={dash.loading} />;
    case "revenue_chart":
      return <RevenueWidget data={dash.revenueByDay} loading={dash.loading} />;
    case "top_services":
      return <TopServicesWidget data={dash.topServices} loading={dash.loading} />;
    case "staff_bookings":
      return <StaffBookingsWidget data={dash.staffBookings} loading={dash.loading} />;
    case "active_staff":
      return <ActiveStaffWidget data={dash.staffList} loading={dash.loading} />;
    case "active_coupons":
      return <ActiveCouponsWidget data={dash.activeCoupons} loading={dash.loading} />;
    case "today_availability":
      return <TodayAvailabilityWidget data={dash.todayAvailability} loading={dash.loading} />;
    case "total_clients":
      return <TotalClientsWidget count={dash.totalClients} loading={dash.loading} />;
  }
}

// ─── Dashboard page ───────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const { token } = useAdminAuth();
  const { admin } = useAppConfig();
  const { isEnabled } = useFeatureFlags();
  const dash = useDashboardData(token);

  // Stat card order
  const [statOrder, setStatOrder] = useState<StatId[]>(loadStatOrder);
  useEffect(() => {
    localStorage.setItem(STAT_STORAGE_KEY, JSON.stringify(statOrder));
  }, [statOrder]);

  // Widget order
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(loadWidgetOrder);
  useEffect(() => {
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgetOrder));
  }, [widgetOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const statCards = buildStatCards(dash.summary, dash.loading);

  // Only include widgets that are feature-enabled and have data
  const visibleWidgets = useMemo(
    () =>
      widgetOrder.filter((id) => {
        const feat = WIDGET_FEATURE_MAP[id];
        return isEnabled(feat as Parameters<typeof isEnabled>[0]) && widgetHasData(id, dash);
      }),
    [widgetOrder, dash, isEnabled],
  );

  function handleStatDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStatOrder((prev) =>
      arrayMove(prev, prev.indexOf(active.id as StatId), prev.indexOf(over.id as StatId)),
    );
  }

  function handleWidgetDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgetOrder((prev) =>
      arrayMove(prev, prev.indexOf(active.id as WidgetId), prev.indexOf(over.id as WidgetId)),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {admin.dashboardTitle}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{admin.dashboardSubtitle}</p>
      </div>

      {/* Stat cards — individually sortable in their own 4-col grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleStatDragEnd}
      >
        <SortableContext items={statOrder} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {statOrder.map((id) => (
              <SortableWidget key={id} id={id}>
                <StatCard {...statCards[id]} />
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* All widgets (including upcoming bookings) — sortable 2-col grid */}
      {visibleWidgets.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleWidgetDragEnd}
        >
          <SortableContext items={visibleWidgets} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {visibleWidgets.map((id) => (
                <SortableWidget
                  key={id}
                  id={id}
                  className={cn(FULL_WIDTH_WIDGETS.has(id) && "lg:col-span-2")}
                >
                  <WidgetContent id={id} dash={dash} />
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
