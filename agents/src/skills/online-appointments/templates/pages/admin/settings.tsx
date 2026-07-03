import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagsContext";
import type { FeatureKey } from "@/lib/features";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Save, CheckCircle } from "lucide-react";

const FIELDS: Array<{ key: string; label: string; featureFlag: FeatureKey }> = [
  { key: "business_name", label: "Business Name", featureFlag: "admin.settings.business_info" },
  { key: "timezone", label: "Timezone", featureFlag: "admin.settings.timezone" },
  {
    key: "available_time_interval",
    label: "Time Slot Interval (ISO 8601, e.g. PT30M)",
    featureFlag: "admin.settings.booking_interval",
  },
];

interface Provider {
  provider: string;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  id: string | null;
}

const ENABLED_CLASS =
  "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900";
const DISABLED_CLASS =
  "bg-zinc-50 text-zinc-600 border-zinc-200 dark:bg-zinc-900/40 dark:text-zinc-400 dark:border-zinc-800";

export default function AdminSettingsPage() {
  const { token } = useAdminAuth();
  const { isEnabled } = useFeatureFlags();

  // Business settings state
  const [, setSettings] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Payment providers state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerSaving, setProviderSaving] = useState<string | null>(null);

  const visibleFields = FIELDS.filter((f) => isEnabled(f.featureFlag));

  useEffect(() => {
    async function loadSettings() {
      const res = await adminFetch("/api/appointments/admin/business-settings", token);
      if (res.ok) {
        const { settings: data } = (await res.json()) as { settings: Record<string, string> };
        setSettings(data);
        setForm(data);
      }
      setLoading(false);
    }
    void loadSettings();
  }, [token]);

  useEffect(() => {
    void loadProviders();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProviders() {
    setProvidersLoading(true);
    try {
      const res = await adminFetch("/api/appointments/admin/payment-providers", token);
      if (res.ok) {
        const { providers: data } = (await res.json()) as { providers: Provider[] };
        setProviders(data);
      }
    } finally {
      setProvidersLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    const updates = visibleFields
      .map((f) => ({ key: f.key, value: form[f.key] ?? "" }))
      .filter((u) => u.value);
    const res = await adminFetch("/api/appointments/admin/business-settings/batch-upsert", token, {
      method: "POST",
      body: JSON.stringify({ settings: updates }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
    setSaving(false);
  }

  async function setupProvider(provider: string) {
    setProviderSaving(provider);
    try {
      await adminFetch("/api/appointments/admin/payment-providers", token, {
        method: "POST",
        body: JSON.stringify({ provider }),
      });
      await loadProviders();
    } finally {
      setProviderSaving(null);
    }
  }

  async function toggleProvider(id: string, enabled: boolean) {
    setProviderSaving(id);
    try {
      await adminFetch(`/api/appointments/admin/payment-providers/${id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      await loadProviders();
    } finally {
      setProviderSaving(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure your appointment business</p>
      </div>

      {/* Business Settings */}
      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Business Settings</h2>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: visibleFields.length || 1 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : visibleFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">All settings sub-sections are disabled.</p>
        ) : (
          visibleFields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label className="text-foreground">{f.label}</Label>
              <Input
                value={form[f.key] ?? ""}
                onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            </div>
          ))
        )}

        <Button onClick={() => void save()} disabled={saving || loading}>
          {saved ? (
            <>
              <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
              Saved
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : "Save Changes"}
            </>
          )}
        </Button>
      </div>

      {/* Payment Providers — only shown when admin.settings.payment is enabled */}
      {isEnabled("admin.settings.payment") && (
        <Card>
          <CardHeader className="flex flex-col px-5 pb-0 pt-5">
            <CardTitle className="text-base font-semibold text-foreground">
              Payment Providers
            </CardTitle>
            <CardDescription className="mt-1 text-sm text-muted-foreground">
              Configure which payment providers are available at checkout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-5 pb-5 pt-5">
            {providersLoading ? (
              <Skeleton key="provider-skeleton" className="h-14 w-full" />
            ) : (
              providers.map((p) => (
                <div
                  key={p.provider}
                  className="flex items-center justify-between rounded-lg border border-border bg-background px-5 py-4"
                >
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-semibold text-foreground">{p.displayName}</p>
                    {p.configured && (
                      <Badge
                        variant="outline"
                        className={cn("text-xs", p.enabled ? ENABLED_CLASS : DISABLED_CLASS)}
                      >
                        {p.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    )}
                    {!p.configured && (
                      <span className="text-xs text-muted-foreground">Not configured</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!p.configured && (
                      <Button
                        size="sm"
                        onClick={() => void setupProvider(p.provider)}
                        disabled={providerSaving === p.provider}
                      >
                        Set Up
                      </Button>
                    )}
                    {p.configured && p.id && (
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={(checked) => {
                          if (p.id) void toggleProvider(p.id, checked);
                        }}
                        disabled={providerSaving === p.id}
                        aria-label={`Toggle ${p.displayName} payments`}
                      />
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
