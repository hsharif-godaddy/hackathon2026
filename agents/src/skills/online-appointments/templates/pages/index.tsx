import { useEffect, useState } from "react";
import { Helmet } from "@dr.pogodin/react-helmet";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  User,
  ShieldCheck,
  ArrowRight,
  Clock,
  CheckCircle,
  Zap,
  LayoutDashboard,
  Lock,
  Smartphone,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useAppConfig } from "@/contexts/AppConfigContext";

interface ServicePreview {
  id: string;
  name: string;
  description: string | null;
  cost: number | null;
  duration: string | null;
}

const FEATURES = [
  {
    icon: Clock,
    title: "Real-time availability",
    desc: "Slots update instantly — no double-bookings.",
  },
  {
    icon: CheckCircle,
    title: "Instant confirmation",
    desc: "Clients get confirmed immediately on checkout.",
  },
  {
    icon: CalendarDays,
    title: "Manage bookings",
    desc: "Reschedule or cancel with a single click.",
  },
  {
    icon: LayoutDashboard,
    title: "Admin dashboard",
    desc: "Full control over services, clients, and schedules.",
  },
  { icon: Lock, title: "Secure auth", desc: "Cookie-based sessions and role-based access." },
  { icon: Smartphone, title: "Mobile-friendly", desc: "Works great on any screen size." },
];

const HOW_IT_WORKS = [
  { num: "1", title: "Browse services", desc: "Pick the service that fits your needs." },
  { num: "2", title: "Choose a time", desc: "Select any open slot from live availability." },
  { num: "3", title: "Confirm & done", desc: "Receive instant confirmation with all the details." },
];

function parseDuration(iso: string | null): string {
  if (!iso) return "";
  const h = iso.match(/(\d+)H/);
  const m = iso.match(/(\d+)M/);
  const parts: string[] = [];
  if (h) parts.push(`${h[1]}h`);
  if (m) parts.push(`${m[1]}m`);
  return parts.join(" ");
}

export default function HomePage() {
  const { isAuthenticated } = useAuth();
  const { home, brand } = useAppConfig();
  const [services, setServices] = useState<ServicePreview[]>([]);

  useEffect(() => {
    fetch("/api/appointments/public/services?per_page=4")
      .then((r) => r.json() as Promise<{ results?: ServicePreview[] }>)
      .then((d) => setServices(d.results ?? []))
      .catch(() => {
        /* ignored */
      });
  }, []);

  return (
    <>
      <Helmet>
        <title>{brand.name}</title>
        <meta name="description" content={home.heroDescription} />
      </Helmet>

      {/* Hero */}
      <section className="border-b border-border bg-background px-4 pb-16 pt-20 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Zap size={11} className="text-amber-500" />
            Online appointment booking — instant &amp; hassle-free
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            {home.heroTitle}
          </h1>
          <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground">
            {home.heroDescription}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="gap-2 rounded-xl">
              <Link to="/book">
                {home.heroCta} <ArrowRight size={16} />
              </Link>
            </Button>
            {!isAuthenticated && (
              <Button asChild size="lg" variant="outline" className="rounded-xl">
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* How it works */}
      {home.showHowItWorks && (
        <section className="border-b border-border bg-muted px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-10 text-center text-2xl font-bold text-foreground">How it works</h2>
            <div className="grid gap-6 md:grid-cols-3">
              {HOW_IT_WORKS.map((s) => (
                <div key={s.num} className="text-center">
                  <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-sm font-bold text-background">
                    {s.num}
                  </div>
                  <h3 className="mb-1 font-semibold text-foreground">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Services preview */}
      {services.length > 0 && (
        <section className="border-b border-border bg-background px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-foreground">Available services</h2>
              <Link
                to="/book"
                className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                View all <ChevronRight size={14} />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {services.map((s) => (
                <Link
                  key={s.id}
                  to={`/book/${s.id}`}
                  className={cn(
                    "group rounded-xl border border-border bg-card p-5 transition-all",
                    "hover:border-border/80 hover:shadow-sm",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="mb-1 font-semibold text-foreground">{s.name}</h3>
                      {s.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      size={16}
                      className="ml-2 mt-0.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                    {s.cost !== null && (
                      <span className="font-medium text-foreground">
                        ${(s.cost / 100).toFixed(2)}
                      </span>
                    )}
                    {s.duration && <span>{parseDuration(s.duration)}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Features grid */}
      {home.showFeatures && (
        <section className="border-b border-border bg-muted px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-10 text-center text-2xl font-bold text-foreground">
              Everything you need
            </h2>
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.title} className="rounded-xl border border-border bg-card p-5">
                    <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                      <Icon size={15} className="text-foreground" />
                    </div>
                    <h3 className="mb-1 text-sm font-semibold text-foreground">{f.title}</h3>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* User journeys */}
      {home.showUserJourneys && (
        <section className="border-b border-border bg-background px-4 py-16">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-2 text-center text-2xl font-bold text-foreground">
              Who is this for?
            </h2>
            <p className="mb-10 text-center text-sm text-muted-foreground">
              Three flows, all in one app
            </p>
            <div className="grid gap-5 md:grid-cols-3">
              {[
                {
                  icon: CalendarDays,
                  label: "Guest",
                  title: "Book without an account",
                  desc: "Browse services, pick a slot, and confirm — no sign-up required.",
                  cta: home.heroCta,
                  href: "/book",
                  iconBg: "bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400",
                },
                {
                  icon: User,
                  label: "Customer",
                  title: "Manage your bookings",
                  desc: "Sign in to view, reschedule, or cancel your past and upcoming appointments.",
                  cta: isAuthenticated ? "View my bookings" : "Sign in",
                  href: isAuthenticated ? "/my-bookings" : "/login",
                  iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
                },
                {
                  icon: ShieldCheck,
                  label: "Admin",
                  title: "Run your business",
                  desc: "Full control over services, bookings, clients, and settings.",
                  cta: "Admin dashboard",
                  href: "/admin",
                  iconBg: "bg-muted text-muted-foreground",
                },
              ].map((j) => {
                const Icon = j.icon;
                return (
                  <div
                    key={j.label}
                    className="flex flex-col rounded-xl border border-border bg-card p-6"
                  >
                    <div
                      className={cn(
                        "mb-4 flex h-9 w-9 items-center justify-center rounded-lg",
                        j.iconBg,
                      )}
                    >
                      <Icon size={17} />
                    </div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {j.label}
                    </p>
                    <h3 className="mb-2 font-semibold text-foreground">{j.title}</h3>
                    <p className="mb-5 flex-1 text-sm text-muted-foreground">{j.desc}</p>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="w-fit gap-1.5 rounded-lg"
                    >
                      <Link to={j.href}>
                        {j.cta} <ArrowRight size={13} />
                      </Link>
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Footer CTA */}
      <section className="bg-muted px-4 py-16">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-3 text-2xl font-bold text-foreground">{home.footerCtaTitle}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{home.footerCtaDescription}</p>
          <Button asChild size="lg" className="gap-2 rounded-xl">
            <Link to="/book">
              {home.footerCtaLabel} <ArrowRight size={16} />
            </Link>
          </Button>
          <div className="mt-4 text-xs text-muted-foreground">
            Developer? Check out the{" "}
            <Link to="/debug" className="underline transition-colors hover:text-foreground">
              debug console
            </Link>{" "}
            for live API logs and DB info.
          </div>
        </div>
      </section>
    </>
  );
}
