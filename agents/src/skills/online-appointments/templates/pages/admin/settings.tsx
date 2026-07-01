import { useEffect, useState } from "react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagsContext";
import type { FeatureKey } from "@/lib/features";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function AdminSettingsPage() {
  const { token } = useAdminAuth();
  const { isEnabled } = useFeatureFlags();
  const [, setSettings] = useState<Record<string, string>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const visibleFields = FIELDS.filter((f) => isEnabled(f.featureFlag));

  useEffect(() => {
    async function load() {
      const res = await adminFetch("/api/appointments/admin/business-settings", token);
      if (res.ok) {
        const { settings: data } = (await res.json()) as { settings: Record<string, string> };
        setSettings(data);
        setForm(data);
      }
      setLoading(false);
    }
    void load();
  }, [token]);

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

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Configure your appointment business</p>
      </div>

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
    </div>
  );
}
