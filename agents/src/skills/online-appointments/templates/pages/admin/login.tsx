import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ShieldCheck, Mail, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminAuth, AdminAuthProvider } from "@/contexts/AdminAuthContext";
import { useAppConfig } from "@/contexts/AppConfigContext";
import PasswordInput from "@/components/admin/auth/PasswordInput";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

function AdminLoginInner() {
  const { login, isAuthenticated, checkSetupRequired } = useAdminAuth();
  const { admin, brand } = useAppConfig();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    if (isAuthenticated) {
      void navigate("/admin", { replace: true });
      return;
    }
    void checkSetupRequired().then((needed) => {
      if (needed) void navigate("/admin/setup", { replace: true });
    });
  }, [isAuthenticated, navigate, checkSetupRequired]);

  const onSubmit = async (data: FormData) => {
    setServerError(null);
    try {
      await login(data.email, data.password);
      void navigate("/admin", { replace: true });
    } catch (err) {
      setAttempts((n) => n + 1);
      setServerError(err instanceof Error ? err.message : "Invalid email or password");
    }
  };

  const BrandIcon = brand.icon ?? ShieldCheck;

  return (
    <div className="flex min-h-[80vh] items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-8">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <BrandIcon className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">{admin.loginTitle}</h1>
          <p className="text-sm text-muted-foreground">{admin.loginDescription}</p>
        </div>

        {/* Form card */}
        <div className="space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4" noValidate>
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
                  autoComplete="email"
                  autoFocus
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
                placeholder="Your password"
                autoComplete="current-password"
                aria-invalid={!!errors.password || !!serverError}
                {...register("password")}
              />
              {errors.password && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {errors.password.message}
                </p>
              )}
            </div>

            {serverError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
                <div className="space-y-0.5">
                  <p className="text-sm text-destructive">{serverError}</p>
                  {attempts >= 3 && (
                    <p className="text-xs text-destructive/80">
                      Make sure this account has been granted admin access.
                    </p>
                  )}
                </div>
              </div>
            )}

            <Button type="submit" className="h-10 w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  Signing in…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign in <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link
            to="/"
            className="underline underline-offset-2 transition-colors hover:text-foreground"
          >
            Back to booking
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <AdminAuthProvider>
      <AdminLoginInner />
    </AdminAuthProvider>
  );
}
