import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "react-router-dom";
import { Menu, LogOut, Settings, Sun, Moon, ExternalLink, PanelLeft } from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/contexts/ThemeContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface DashboardConfig {
  sidebar?: {
    logo?: { text?: string; image?: string; href?: string };
    navigation?: {
      main?: Array<{
        title: string;
        href: string;
        icon?: ComponentType<{ className?: string }>;
        active?: boolean;
        badge?: string | number;
      }>;
    };
    user?: {
      name?: string;
      email?: string;
      initials?: string;
      onLogout?: () => void;
      onSettings?: () => void;
      onProfile?: () => void;
    };
  };
  header?: {
    user?: {
      name?: string;
      email?: string;
      initials?: string;
      onLogout?: () => void;
    };
  };
  main?: {
    maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
    padding?: boolean;
    className?: string;
  };
}

interface DashboardProps {
  children: ReactNode;
  config?: DashboardConfig;
  className?: string;
}

const maxWidthClasses = {
  sm: "max-w-screen-sm",
  md: "max-w-screen-md",
  lg: "max-w-screen-lg",
  xl: "max-w-screen-xl",
  "2xl": "max-w-screen-2xl",
  full: "max-w-full",
};

type NavItem = NonNullable<
  NonNullable<NonNullable<DashboardConfig["sidebar"]>["navigation"]>["main"]
>[number];

function NavLink({
  item,
  collapsed,
  onClick,
}: {
  item: NavItem;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  const link = (
    <Link
      to={item.href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        item.active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        collapsed && "justify-center px-2",
      )}
    >
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.title}</span>
          {item.badge !== undefined && (
            <span
              className={cn(
                "ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium",
                item.active
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="font-medium">
        {item.title}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarNav({
  config,
  collapsed,
  onNavClick,
}: {
  config: DashboardConfig;
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const { theme, toggleTheme } = useTheme();
  const { sidebar = {} } = config;
  const { logo = { text: "Admin" }, navigation = {} } = sidebar;
  const user = sidebar.user ?? (config.header?.user ? { ...config.header.user } : undefined);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-border",
            collapsed ? "justify-center px-3" : "gap-3 px-4",
          )}
        >
          <Link
            to={logo.href ?? "/admin"}
            className={cn("flex min-w-0 items-center gap-2.5", collapsed && "justify-center")}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary shadow-sm">
              <span className="text-xs font-bold text-primary-foreground">
                {(logo.text ?? "A").charAt(0).toUpperCase()}
              </span>
            </div>
            {!collapsed && (
              <span className="truncate text-sm font-semibold text-foreground">{logo.text}</span>
            )}
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {navigation.main?.map((item) => (
            <NavLink key={item.href} item={item} collapsed={collapsed} onClick={onNavClick} />
          ))}
        </nav>

        <Separator />

        {/* Utility links */}
        <div className="space-y-0.5 px-2 py-2">
          {collapsed ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleTheme}
                    className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/"
                    target="_blank"
                    className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">View site</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <>
              <button
                onClick={toggleTheme}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {theme === "dark" ? (
                  <Sun className="h-[18px] w-[18px]" />
                ) : (
                  <Moon className="h-[18px] w-[18px]" />
                )}
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              </button>
              <Link
                to="/"
                target="_blank"
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ExternalLink className="h-[18px] w-[18px]" />
                <span>View site</span>
              </Link>
            </>
          )}
        </div>

        <Separator />

        {/* User dropdown */}
        {user && (
          <div className="px-2 py-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent",
                    collapsed && "justify-center",
                  )}
                >
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-muted text-xs font-semibold text-muted-foreground">
                      {user.initials ?? (user.name ?? "A").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <div className="min-w-0 flex-1">
                      <p className="mb-0.5 truncate text-sm font-medium leading-none text-foreground">
                        {user.name ?? "Administrator"}
                      </p>
                      {user.email && (
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      )}
                    </div>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-52">
                <DropdownMenuLabel className="pb-2 font-normal">
                  <p className="text-sm font-medium">{user.name ?? "Administrator"}</p>
                  {user.email && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{user.email}</p>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {user.onSettings && (
                  <DropdownMenuItem onClick={user.onSettings}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </DropdownMenuItem>
                )}
                {user.onLogout && (
                  <DropdownMenuItem
                    onClick={user.onLogout}
                    className="text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default function Dashboard({ children, config = {}, className }: DashboardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { sidebar = {}, main = {} } = config;
  const { logo = {}, navigation = {} } = sidebar;
  const { maxWidth = "full", padding = true, className: mainClassName } = main;

  const currentPage = navigation.main?.find((i) => i.active)?.title ?? logo.text ?? "Admin";

  return (
    <div
      className={cn(
        "flex h-screen gap-2 overflow-hidden bg-muted/40 p-2 dark:bg-zinc-950",
        className,
      )}
    >
      {/* Desktop sidebar — inset card */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col transition-all duration-200 ease-in-out lg:flex",
          collapsed ? "w-[52px]" : "w-56",
        )}
      >
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <SidebarNav config={config} collapsed={collapsed} />
        </div>
      </aside>

      {/* Mobile sidebar — Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-56 flex-col gap-0 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav config={config} collapsed={false} onNavClick={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main content — inset card, matches sidebar */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Header — matches reference SiteHeader pattern */}
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3 lg:px-4">
          {/* Desktop: sidebar collapse toggle */}
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setCollapsed((c) => !c)}
                  className="hidden items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:flex"
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  <PanelLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {/* Mobile: hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex items-center justify-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>

          <Separator orientation="vertical" className="mx-1 h-4" />

          <span className="text-sm font-medium text-foreground">{currentPage}</span>
        </header>

        {/* Page content */}
        <main
          className={cn("flex-1 overflow-y-auto", padding && "p-4 lg:p-6", mainClassName)}
          key={location.pathname}
        >
          <div className={cn("mx-auto", maxWidthClasses[maxWidth])}>{children}</div>
        </main>
      </div>
    </div>
  );
}
