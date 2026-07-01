import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, Flag, Lock, CheckCircle2, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAuth, AdminAuthProvider } from "@/contexts/AdminAuthContext";
import AuthShell from "@/components/admin/auth/AuthShell";
import PasswordInput from "@/components/admin/auth/PasswordInput";
import PasswordStrength from "@/components/admin/auth/PasswordStrength";

interface StrategyInfo {
  name: string;
  display_name: string;
  description: string;
}

interface SetupStatus {
  ready: boolean;
  strategy: StrategyInfo;
  available_strategies: StrategyInfo[];
}

const schema = z
  .object({
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(6, "Must be at least 6 characters").max(128),
    confirm: z.string().min(1, "Please confirm your password"),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

type FormData = z.infer<typeof schema>;

function LeftPanel({ strategy }: { strategy: StrategyInfo }) {
  return (
    <>
      <div className="space-y-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-background/10 bg-background/5 px-3 py-1.5">
          <Flag className="h-3.5 w-3.5 text-background/60" />
          <span className="text-xs font-medium text-background/60">One-time setup</span>
        </div>

        <h1 className="text-3xl font-bold leading-snug text-background">
          You're the first here.
          <br />
          <span className="text-background/60">Claim admin access.</span>
        </h1>

        <p className="max-w-xs text-sm leading-relaxed text-background/60">
          This screen appears only once — on a fresh deployment with no admin configured. Set your
          email and password to become the permanent administrator.
        </p>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-background/40">
          What happens after setup
        </p>
        {[
          { icon: Lock, text: "Your password is hashed with scrypt and stored securely." },
          { icon: ShieldCheck, text: "This setup page is locked — no one else can claim access." },
          {
            icon: CheckCircle2,
            text: "You're signed in automatically and taken to the dashboard.",
          },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-background/5">
              <Icon className="h-3 w-3 text-background/60" />
            </div>
            <p className="text-sm text-background/60">{text}</p>
          </div>
        ))}
      </div>

      <div className="inline-flex items-center gap-2 text-xs text-background/40">
        <ShieldCheck className="h-3.5 w-3.5" />
        Strategy: <span className="font-medium text-background/60">{strategy.display_name}</span>
      </div>
    </>
  );
}

function SuccessState() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="space-y-3 text-center">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
          <CheckCircle2 className="h-7 w-7 text-green-500" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Admin configured</h2>
        <p className="text-sm text-muted-foreground">Taking you to the dashboard…</p>
      </div>
    </div>
  );
}

function AdminSetupInner() {
  const { isAuthenticated } = useAdminAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      void navigate("/admin", { replace: true });
      return;
    }
    void fetch("/api/appointments/admin/auth/setup")
      .then((r) => r.json())
      .then((d: SetupStatus) => {
        if (d.ready) void navigate("/admin/login", { replace: true });
        else setStatus(d);
      });
  }, [isAuthenticated, navigate]);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const passwordValue = useWatch({ control, name: "password", defaultValue: "" });

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      const res = await fetch("/api/appointments/admin/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const body = (await res.json()) as { error?: string; token?: string };
      if (!res.ok) {
        setServerError(body.error ?? "Setup failed. Please try again.");
        return;
      }

      if (body.token) {
        localStorage.setItem("admin_token", body.token);
        setDone(true);
        setTimeout(() => void navigate("/admin", { replace: true }), 1200);
      } else {
        setDone(true);
        setTimeout(() => void navigate("/admin/login", { replace: true }), 1500);
      }
    } catch {
      setServerError("Network error. Please check your connection and try again.");
    }
  };

  if (done) return <SuccessState />;
  if (!status) return null;

  const formPanel = (
    <div className="space-y-8">
      <div className="space-y-1">
        <h2 className="text-2xl font-bold text-foreground">Create admin account</h2>
        <p className="text-sm text-muted-foreground">
          Set your email and a strong password to claim admin access.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-5" noValidate>
        {/* Email */}
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium text-foreground">
            Email address
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              autoFocus
              autoComplete="email"
              className="pl-9"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
          </div>
          {errors.email && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium text-foreground">
            Password
          </Label>
          <PasswordInput
            id="password"
            placeholder="Choose a strong password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          <PasswordStrength password={passwordValue} />
          {errors.password && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Confirm */}
        <div className="space-y-1.5">
          <Label htmlFor="confirm" className="text-sm font-medium text-foreground">
            Confirm password
          </Label>
          <PasswordInput
            id="confirm"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm}
            {...register("confirm")}
          />
          {errors.confirm && (
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {errors.confirm.message}
            </p>
          )}
        </div>

        {serverError && (
          <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{serverError}</p>
          </div>
        )}

        <Button type="submit" className="h-10 w-full font-medium" disabled={isSubmitting}>
          {isSubmitting ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              Setting up…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Flag className="h-4 w-4" />
              Claim admin access
            </span>
          )}
        </Button>
      </form>

      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        This page will be permanently locked after setup.
        <br />
        Only you will have admin access.
      </p>
    </div>
  );

  return <AuthShell left={<LeftPanel strategy={status.strategy} />} right={formPanel} />;
}

export default function AdminSetupPage() {
  return (
    <AdminAuthProvider>
      <AdminSetupInner />
    </AdminAuthProvider>
  );
}
