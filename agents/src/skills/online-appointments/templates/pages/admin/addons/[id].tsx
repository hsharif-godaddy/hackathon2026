import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { FormEvent } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface AddonFormData {
  title: string;
  description: string;
  price: number;
  durationMinutes: number;
  active: boolean;
}

interface AddonResponse {
  addon?: {
    title?: string;
    description?: string | null;
    price?: string;
    duration?: string;
    active?: boolean;
  };
}

interface ErrorResponse {
  message?: string;
}

function isoToMinutes(iso: string | undefined): number {
  if (!iso) return 0;
  // eslint-disable-next-line security/detect-unsafe-regex
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return parseInt(m[1] ?? "0", 10) * 60 + parseInt(m[2] ?? "0", 10);
}

function minutesToIso(minutes: number): string {
  if (!minutes || minutes <= 0) return "PT0M";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h > 0 ? `${h}H` : ""}${m > 0 || h === 0 ? `${m}M` : ""}`;
}

export default function AdminAddonDetailPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<AddonFormData>({
    title: "",
    description: "",
    price: 0,
    durationMinutes: 0,
    active: true,
  });

  const loadAddon = useCallback(
    async (addonId: string) => {
      try {
        setLoading(true);
        const res = await adminFetch(`/api/appointments/admin/addons/${addonId}`, token);
        if (res.ok) {
          const data = (await res.json()) as AddonResponse;
          const addon = data.addon ?? {};
          setFormData({
            title: addon.title ?? "",
            description: addon.description ?? "",
            price: addon.price ? parseFloat(addon.price) : 0,
            durationMinutes: isoToMinutes(addon.duration),
            active: addon.active ?? true,
          });
        } else {
          toast.error("Failed to load add-on");
          void navigate("/admin/addons");
        }
      } catch (err) {
        toast.error("Error loading add-on");
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [token, navigate],
  );

  useEffect(() => {
    if (!isNew && id) {
      void loadAddon(id);
    }
  }, [id, isNew, loadAddon]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!formData.title.trim()) {
      toast.error("Title is required");
      return;
    }
    if (formData.price < 0) {
      toast.error("Price cannot be negative");
      return;
    }
    if (formData.durationMinutes < 0) {
      toast.error("Duration cannot be negative");
      return;
    }

    try {
      setSaving(true);

      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim() || null,
        price: formData.price,
        duration: minutesToIso(formData.durationMinutes),
        active: formData.active,
      };

      const url = isNew ? "/api/appointments/admin/addons" : `/api/appointments/admin/addons/${id}`;

      const res = await adminFetch(url, token, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(isNew ? "Add-on created successfully" : "Add-on updated successfully");
        void navigate("/admin/addons");
      } else {
        const errData = (await res.json().catch(() => ({}))) as ErrorResponse;
        toast.error(errData.message ?? "Failed to save add-on");
      }
    } catch (err) {
      toast.error("Error saving add-on");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigate("/admin/addons");
          }}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Add-ons
        </Button>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          {isNew ? "Create Add-on" : "Edit Add-on"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {isNew ? "Create a new optional extra" : "Update add-on details"}
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-6"
      >
        <div className="space-y-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          {/* Title */}
          <div>
            <Label htmlFor="title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input
              id="title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g. Hot towel treatment"
              className="mt-1.5"
              required
            />
          </div>

          {/* Description */}
          <div>
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
              placeholder="Optional description shown to customers"
              className="mt-1.5 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            />
          </div>

          {/* Price and Duration */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="price">Price ($)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                placeholder="0.00"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="duration">Extra duration (minutes)</Label>
              <Input
                id="duration"
                type="number"
                min="0"
                step="1"
                value={formData.durationMinutes}
                onChange={(e) =>
                  setFormData({ ...formData, durationMinutes: Number(e.target.value) })
                }
                placeholder="0"
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Added to the appointment length when selected
              </p>
            </div>
          </div>

          {/* Active */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="active">Active</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Only active add-ons are offered to customers
              </p>
            </div>
            <Switch
              id="active"
              checked={formData.active}
              onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigate("/admin/addons");
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (
              "Saving..."
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {isNew ? "Create Add-on" : "Save Changes"}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
