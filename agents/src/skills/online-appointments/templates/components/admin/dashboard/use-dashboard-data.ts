import { useEffect, useState } from "react";
import { subDays, format } from "date-fns";
import { adminFetch } from "@/contexts/AdminAuthContext";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// --- Raw API types ---

interface RawBooking {
  id: string;
  status: string;
  startTime: string;
  serviceName?: string | null;
  serviceCost?: string | null;
  staffName?: string | null;
  clientEmail?: string | null;
}

export interface StaffMember {
  id: string;
  name: string | null;
  role: string;
  deletedAt: string | null;
  contact: { email: string | null; phone_number: string | null } | null;
}

export interface ActiveCoupon {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  discountPrice: number | null;
  discountPercentage: number | null;
  endDate: string;
  currentUsage: number | null;
  limit: number | null;
  isActive: boolean;
  state: string;
}

export interface TimeBlock {
  startTime: string;
  endTime: string;
}

export interface DayHours {
  active: boolean;
  timeBlocks: TimeBlock[];
}

// --- Derived widget data types ---

export interface BookingSummary {
  total: number;
  unpaid: string | number;
  paid: string | number;
  cancelled: number;
}

export interface TrendDay {
  date: string;
  bookings: number;
  cancelled: number;
}

export interface RevenueDay {
  date: string;
  revenue: number;
}

export interface ServiceCount {
  name: string;
  bookings: number;
  fill: string;
}

export interface StaffBookingCount {
  name: string;
  bookings: number;
  fill: string;
}

export interface BookingRow {
  id: string;
  serviceName?: string | null;
  clientEmail?: string | null;
  staffName?: string | null;
  startTime: string;
  status: string;
  amount?: number | null;
}

export interface DashboardData {
  summary: BookingSummary | null;
  bookingsTrend: TrendDay[] | null;
  revenueByDay: RevenueDay[] | null;
  topServices: ServiceCount[] | null;
  staffBookings: StaffBookingCount[] | null;
  upcomingBookings: BookingRow[] | null;
  staffList: StaffMember[] | null;
  totalClients: number | null;
  activeCoupons: ActiveCoupon[] | null;
  todayAvailability: DayHours | null;
  loading: boolean;
}

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export function useDashboardData(token: string | null): DashboardData {
  const [data, setData] = useState<DashboardData>({
    loading: true,
    summary: null,
    bookingsTrend: null,
    revenueByDay: null,
    topServices: null,
    staffBookings: null,
    upcomingBookings: null,
    staffList: null,
    totalClients: null,
    activeCoupons: null,
    todayAvailability: null,
  });

  useEffect(() => {
    async function load() {
      const today = new Date();
      const startDate = subDays(today, 30).toISOString();

      const [sumRes, recentRes, upcomingRes, staffRes, clientsRes, couponsRes, availRes] =
        await Promise.allSettled([
          adminFetch("/api/appointments/admin/bookings/summary", token),
          adminFetch(
            `/api/appointments/admin/bookings?per_page=200&start_date=${encodeURIComponent(startDate)}`,
            token,
          ),
          adminFetch("/api/appointments/admin/bookings/upcoming?per_page=20", token),
          adminFetch("/api/appointments/admin/staff?per_page=100", token),
          adminFetch("/api/appointments/admin/clients?per_page=1", token),
          adminFetch("/api/appointments/admin/coupons?isActive=true", token),
          adminFetch("/api/appointments/admin/availability", token),
        ]);

      // Summary
      let summary: BookingSummary | null = null;
      if (sumRes.status === "fulfilled" && sumRes.value.ok) {
        const d = (await sumRes.value.json()) as { summary?: BookingSummary } & BookingSummary;
        summary = d.summary ?? d;
      }

      // Recent bookings (last 30 days)
      let recentBookings: RawBooking[] = [];
      if (recentRes.status === "fulfilled" && recentRes.value.ok) {
        const d = (await recentRes.value.json()) as { results?: RawBooking[] };
        recentBookings = d.results ?? [];
      }

      // Upcoming bookings
      let upcomingBookings: BookingRow[] | null = null;
      if (upcomingRes.status === "fulfilled" && upcomingRes.value.ok) {
        const d = (await upcomingRes.value.json()) as {
          results?: RawBooking[];
          data?: RawBooking[];
        };
        const rows = (d.results ?? d.data ?? []).map((b) => ({
          id: b.id,
          serviceName: b.serviceName,
          clientEmail: b.clientEmail,
          staffName: b.staffName,
          startTime: b.startTime,
          status: b.status,
        }));
        upcomingBookings = rows.length > 0 ? rows : null;
      }

      // Staff
      let staffList: StaffMember[] | null = null;
      if (staffRes.status === "fulfilled" && staffRes.value.ok) {
        const d = (await staffRes.value.json()) as { results?: StaffMember[] };
        const active = (d.results ?? []).filter((s) => !s.deletedAt);
        staffList = active.length > 0 ? active : null;
      }

      // Total clients
      let totalClients: number | null = null;
      if (clientsRes.status === "fulfilled" && clientsRes.value.ok) {
        const d = (await clientsRes.value.json()) as { total_count?: number };
        const tc = d.total_count ?? 0;
        if (tc > 0) totalClients = tc;
      }

      // Active coupons
      let activeCoupons: ActiveCoupon[] | null = null;
      if (couponsRes.status === "fulfilled" && couponsRes.value.ok) {
        const d = (await couponsRes.value.json()) as { coupons?: ActiveCoupon[] };
        const active = (d.coupons ?? []).filter((c) => c.isActive && c.state === "ACTIVE");
        activeCoupons = active.length > 0 ? active : null;
      }

      // Today's availability
      let todayAvailability: DayHours | null = null;
      if (availRes.status === "fulfilled" && availRes.value.ok) {
        const d = (await availRes.value.json()) as {
          business_hours?: Record<string, DayHours>;
        };
        const todayKey = DAY_NAMES[today.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6];
        const hours = d.business_hours?.[todayKey];
        if (hours?.active) todayAvailability = hours;
      }

      // --- Derive chart data from recentBookings ---

      // 30-day trend
      const trendDays = Array.from({ length: 30 }, (_, i) =>
        format(subDays(today, 29 - i), "yyyy-MM-dd"),
      );
      const trendMap = new Map(trendDays.map((d) => [d, { bookings: 0, cancelled: 0 }]));
      for (const b of recentBookings) {
        if (!b.startTime) continue;
        const day = format(new Date(b.startTime), "yyyy-MM-dd");
        const entry = trendMap.get(day);
        if (entry) {
          if (b.status === "cancelled") entry.cancelled++;
          else entry.bookings++;
        }
      }
      const bookingsTrend = Array.from(trendMap.entries()).map(([date, v]) => ({ date, ...v }));
      const hasTrend = bookingsTrend.some((t) => t.bookings > 0 || t.cancelled > 0);

      // 14-day revenue
      const revDays = Array.from({ length: 14 }, (_, i) =>
        format(subDays(today, 13 - i), "yyyy-MM-dd"),
      );
      const revMap = new Map(revDays.map((d) => [d, 0]));
      for (const b of recentBookings) {
        if (b.status !== "paid" || !b.serviceCost || !b.startTime) continue;
        const day = format(new Date(b.startTime), "yyyy-MM-dd");
        if (revMap.has(day)) revMap.set(day, (revMap.get(day) ?? 0) + parseFloat(b.serviceCost));
      }
      const revenueByDay = Array.from(revMap.entries()).map(([date, revenue]) => ({
        date,
        revenue,
      }));
      const hasRevenue = revenueByDay.some((r) => r.revenue > 0);

      // Top services
      const svcMap = new Map<string, number>();
      for (const b of recentBookings) {
        if (b.serviceName) svcMap.set(b.serviceName, (svcMap.get(b.serviceName) ?? 0) + 1);
      }
      const topServices = Array.from(svcMap.entries())
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([name, bookings], i) => ({ name, bookings, fill: CHART_COLORS[i % 5] as string }));

      // Staff bookings
      const staffMap = new Map<string, number>();
      for (const b of recentBookings) {
        if (b.staffName) staffMap.set(b.staffName, (staffMap.get(b.staffName) ?? 0) + 1);
      }
      const staffBookings = Array.from(staffMap.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([name, bookings], i) => ({ name, bookings, fill: CHART_COLORS[i % 5] as string }));

      setData({
        loading: false,
        summary,
        bookingsTrend: hasTrend ? bookingsTrend : null,
        revenueByDay: hasRevenue ? revenueByDay : null,
        topServices: topServices.length > 0 ? topServices : null,
        staffBookings: staffBookings.length > 0 ? staffBookings : null,
        upcomingBookings,
        staffList,
        totalClients,
        activeCoupons,
        todayAvailability,
      });
    }

    void load();
  }, [token]);

  return data;
}
