import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { type ComponentType, useEffect } from "react";
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  Clock,
  Tag,
  Settings,
  UserCog,
  BriefcaseBusiness,
  CreditCard,
} from "lucide-react";
import Dashboard, { type DashboardConfig } from "./AdminDashboard";
import { AdminAuthProvider, useAdminAuth } from "@/contexts/AdminAuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagsContext";
import type { FeatureKey } from "@/lib/features";

function AdminLayoutInner() {
  const { isAuthenticated, logout } = useAdminAuth();
  const { isEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const location = useLocation();

  const isAuthPage = location.pathname === "/admin/login" || location.pathname === "/admin/setup";

  useEffect(() => {
    if (!isAuthenticated && !isAuthPage) {
      void navigate("/admin/login", { replace: true });
    }
  }, [isAuthenticated, isAuthPage, navigate]);

  if (!isAuthenticated && !isAuthPage) return null;
  if (isAuthPage) return <Outlet />;

  const allNavItems: Array<{
    title: string;
    href: string;
    icon: ComponentType<{ className?: string }>;
    active: boolean;
    featureKey?: FeatureKey;
  }> = [
    {
      title: "Dashboard",
      href: "/admin",
      icon: LayoutDashboard,
      active: location.pathname === "/admin",
    },
    {
      title: "Bookings",
      href: "/admin/bookings",
      icon: CalendarCheck,
      active: location.pathname.startsWith("/admin/bookings"),
      featureKey: "admin.bookings",
    },
    {
      title: "Services",
      href: "/admin/services",
      icon: BriefcaseBusiness,
      active: location.pathname.startsWith("/admin/services"),
      featureKey: "admin.services",
    },
    {
      title: "Clients",
      href: "/admin/clients",
      icon: Users,
      active: location.pathname.startsWith("/admin/clients"),
      featureKey: "admin.clients",
    },
    {
      title: "Staff",
      href: "/admin/staff",
      icon: UserCog,
      active: location.pathname.startsWith("/admin/staff"),
      featureKey: "admin.staff",
    },
    {
      title: "Availability",
      href: "/admin/availability",
      icon: Clock,
      active: location.pathname === "/admin/availability",
      featureKey: "admin.availability",
    },
    {
      title: "Coupons",
      href: "/admin/coupons",
      icon: Tag,
      active: location.pathname.startsWith("/admin/coupons"),
      featureKey: "admin.coupons",
    },
    {
      title: "Payments",
      href: "/admin/payments",
      icon: CreditCard,
      active: location.pathname.startsWith("/admin/payments"),
      featureKey: "admin.payments",
    },
    {
      title: "Settings",
      href: "/admin/settings",
      icon: Settings,
      active: location.pathname === "/admin/settings",
      featureKey: "admin.settings",
    },
  ];

  const config: DashboardConfig = {
    sidebar: {
      logo: { text: "Admin Panel", href: "/admin" },
      navigation: {
        main: allNavItems
          .filter((item) => !item.featureKey || isEnabled(item.featureKey))
          .map(({ featureKey: _featureKey, ...rest }) => rest),
      },
      user: {
        name: "Administrator",
        initials: "A",
        onLogout: () => {
          void logout().then(() => navigate("/admin/login"));
        },
        onSettings: () => {
          void navigate("/admin/settings");
        },
        onProfile: () => {
          void navigate("/admin/settings");
        },
      },
    },
  };

  return (
    <Dashboard config={config}>
      <Outlet />
    </Dashboard>
  );
}

export default function AdminLayout() {
  return (
    <ThemeProvider>
      <AdminAuthProvider>
        <AdminLayoutInner />
      </AdminAuthProvider>
    </ThemeProvider>
  );
}
