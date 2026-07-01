import { Link, useLocation } from "react-router-dom";
import { Menu, X, CalendarDays, Sun, Moon, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";

export default function Header() {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isActive = (href: string) =>
    href === "/" ? location.pathname === "/" : location.pathname.startsWith(href);

  const navLinkClass = (href: string) =>
    [
      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
      isActive(href)
        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800",
    ].join(" ");

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/80 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex h-14 items-center justify-between">
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 dark:bg-zinc-100">
              <CalendarDays size={14} className="text-white dark:text-zinc-900" />
            </div>
            Booking
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 md:flex">
            <Link to="/" className={navLinkClass("/")}>
              Home
            </Link>
            <Link to="/book" className={navLinkClass("/book")}>
              Book
            </Link>
            {isAuthenticated && (
              <Link to="/my-bookings" className={navLinkClass("/my-bookings")}>
                My Bookings
              </Link>
            )}
            <Link to="/admin" className={navLinkClass("/admin")}>
              <ShieldCheck size={13} className="mr-0.5" />
              Admin
            </Link>
          </nav>

          {/* CTA + Dark toggle */}
          <div className="hidden items-center gap-2 md:flex">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {isAuthenticated ? (
              <>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {user?.displayName ?? user?.email}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-lg text-zinc-700 dark:text-zinc-300"
                  onClick={() => void logout()}
                >
                  <LogOut size={13} /> Sign out
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="rounded-lg">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm" className="rounded-lg">
                  <Link to="/book">Book now</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile toggle */}
          <div className="flex items-center gap-1 md:hidden">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="rounded-lg p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              aria-label="Toggle menu"
            >
              {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMobileMenuOpen && (
          <div className="space-y-1 border-t border-zinc-100 py-3 dark:border-zinc-800 md:hidden">
            <Link to="/" className={navLinkClass("/")} onClick={() => setIsMobileMenuOpen(false)}>
              Home
            </Link>
            <Link
              to="/book"
              className={navLinkClass("/book")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Book
            </Link>
            {isAuthenticated && (
              <Link
                to="/my-bookings"
                className={navLinkClass("/my-bookings")}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                My Bookings
              </Link>
            )}
            <Link
              to="/admin"
              className={navLinkClass("/admin")}
              onClick={() => setIsMobileMenuOpen(false)}
            >
              Admin
            </Link>
            <div className="pt-2">
              {isAuthenticated ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5 rounded-lg"
                  onClick={() => {
                    void logout();
                    setIsMobileMenuOpen(false);
                  }}
                >
                  <LogOut size={13} /> Sign out
                </Button>
              ) : (
                <Button asChild size="sm" className="w-full rounded-lg">
                  <Link to="/book" onClick={() => setIsMobileMenuOpen(false)}>
                    Book now
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
