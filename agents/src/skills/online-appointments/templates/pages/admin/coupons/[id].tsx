import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { FormEvent } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface CouponFormData {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  discountPercentage?: number;
  discountPrice?: number;
  minimumCartValue: number;
  startDate: string;
  endDate: string;
  limitUses: boolean;
  limit?: number;
  isActive: boolean;
}

interface CouponApiData {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  discountPercentage?: number;
  discountPrice?: number;
  minimumCartValue: number;
  startDate: string;
  endDate: string;
  limitUses: boolean;
  limit?: number;
  isActive: boolean;
}

interface CouponResponse {
  coupon?: CouponApiData;
  code?: string;
  type?: "PERCENTAGE" | "FIXED";
  discountPercentage?: number;
  discountPrice?: number;
  minimumCartValue?: number;
  startDate?: string;
  endDate?: string;
  limitUses?: boolean;
  limit?: number;
  isActive?: boolean;
}

interface ErrorResponse {
  message?: string;
  details?: Array<{ message: string }>;
}

export default function AdminCouponDetailPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new";

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<CouponFormData>({
    code: "",
    type: "PERCENTAGE",
    discountPercentage: 10,
    minimumCartValue: 0,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    limitUses: false,
    isActive: true,
  });

  const loadCoupon = useCallback(
    async (couponId: string) => {
      try {
        setLoading(true);
        const res = await adminFetch(`/api/appointments/admin/coupons/${couponId}`, token);

        if (res.ok) {
          const data = (await res.json()) as CouponResponse;
          const coupon = data.coupon ?? data;
          setFormData({
            code: coupon.code ?? "",
            type: coupon.type ?? "PERCENTAGE",
            discountPercentage: coupon.discountPercentage,
            discountPrice: coupon.discountPrice,
            minimumCartValue: coupon.minimumCartValue ?? 0,
            startDate: coupon.startDate ?? "",
            endDate: coupon.endDate ?? "",
            limitUses: coupon.limitUses ?? false,
            limit: coupon.limit,
            isActive: coupon.isActive ?? true,
          });
        } else {
          toast.error("Failed to load coupon");
          void navigate("/admin/coupons");
        }
      } catch (err) {
        toast.error("Error loading coupon");
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [token, navigate],
  );

  useEffect(() => {
    if (!isNew && id) {
      void loadCoupon(id);
    }
  }, [id, isNew, loadCoupon]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Validation
    if (!formData.code.trim()) {
      toast.error("Coupon code is required");
      return;
    }

    if (formData.type === "PERCENTAGE") {
      if (
        !formData.discountPercentage ||
        formData.discountPercentage < 1 ||
        formData.discountPercentage > 100
      ) {
        toast.error("Discount percentage must be between 1 and 100");
        return;
      }
    } else {
      if (!formData.discountPrice || formData.discountPrice <= 0) {
        toast.error("Discount price must be greater than 0");
        return;
      }
    }

    if (new Date(formData.endDate) < new Date(formData.startDate)) {
      toast.error("End date must be after start date");
      return;
    }

    if (formData.limitUses && (!formData.limit || formData.limit <= 0)) {
      toast.error("Limit must be greater than 0 when limit uses is enabled");
      return;
    }

    try {
      setSaving(true);

      let payload: Record<string, unknown>;

      if (isNew) {
        // For CREATE: send all fields
        payload = {
          ...formData,
          code: formData.code.toUpperCase(),
          // discountPrice: user types dollars, stored as-is, convert to cents here
          discountPrice: formData.discountPrice
            ? Math.round(formData.discountPrice * 100)
            : undefined,
          // minimumCartValue: onChange already stores cents (Math.round(input * 100))
          minimumCartValue: formData.minimumCartValue,
        };
      } else {
        // For UPDATE: only send updatable fields (following ola-coupons-service)
        // Only operational fields can be updated: endDate, limit, isActive
        payload = {
          endDate: formData.endDate,
          isActive: formData.isActive,
        };

        // Only include limit if it has a value (limitUses is immutable, can't be changed after creation)
        if (formData.limit !== undefined) {
          payload.limit = formData.limit;
        }
      }

      const url = isNew
        ? "/api/appointments/admin/coupons"
        : `/api/appointments/admin/coupons/${id}`;

      const res = await adminFetch(url, token, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        toast.success(isNew ? "Coupon created successfully" : "Coupon updated successfully");
        void navigate("/admin/coupons");
      } else {
        const errData = (await res.json()) as ErrorResponse;
        toast.error(errData.message ?? errData.details?.[0]?.message ?? "Failed to save coupon");
      }
    } catch (err) {
      toast.error("Error saving coupon");
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
            void navigate("/admin/coupons");
          }}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Coupons
        </Button>
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">
          {isNew ? "Create Coupon" : "Edit Coupon"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {isNew ? "Create a new discount coupon" : "Update coupon details"}
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
          {/* Coupon Code */}
          <div>
            <Label htmlFor="code">
              Coupon Code <span className="text-red-500">*</span>
            </Label>
            <Input
              id="code"
              type="text"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="SAVE20"
              disabled={!isNew}
              className="mt-1.5"
              required
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Alphanumeric only, will be converted to uppercase
            </p>
          </div>

          {/* Type and Discount */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="type">
                Discount Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={formData.type}
                onValueChange={(value: "PERCENTAGE" | "FIXED") =>
                  setFormData({ ...formData, type: value })
                }
                disabled={!isNew}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                  <SelectItem value="FIXED">Fixed Amount</SelectItem>
                </SelectContent>
              </Select>
              {!isNew && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Discount type cannot be changed after creation
                </p>
              )}
            </div>

            {formData.type === "PERCENTAGE" ? (
              <div>
                <Label htmlFor="discountPercentage">
                  Discount Percentage (%) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="discountPercentage"
                  type="number"
                  min="1"
                  max="100"
                  value={formData.discountPercentage ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      discountPercentage: Number(e.target.value),
                    })
                  }
                  placeholder="10"
                  className="mt-1.5"
                  disabled={!isNew}
                  required
                />
                {!isNew && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Discount value cannot be changed after creation
                  </p>
                )}
              </div>
            ) : (
              <div>
                <Label htmlFor="discountPrice">
                  Discount Amount ($) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="discountPrice"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={formData.discountPrice ?? ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      discountPrice: Number(e.target.value),
                    })
                  }
                  placeholder="10.00"
                  className="mt-1.5"
                  disabled={!isNew}
                  required
                />
                {!isNew && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Discount value cannot be changed after creation
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Minimum Cart Value */}
          <div>
            <Label htmlFor="minimumCartValue">Minimum Cart Value ($)</Label>
            <Input
              id="minimumCartValue"
              type="number"
              min="0"
              step="1"
              value={formData.minimumCartValue / 100 || 0}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  minimumCartValue: Math.round(Number(e.target.value) * 100),
                })
              }
              placeholder="0.00"
              className="mt-1.5"
              disabled={!isNew}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {isNew
                ? "Set to 0 for no minimum"
                : "Minimum cart value cannot be changed after creation"}
            </p>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="startDate">
                Start Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="mt-1.5"
                disabled={!isNew}
                required
              />
              {!isNew && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Start date cannot be changed after creation
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="endDate">
                End Date <span className="text-red-500">*</span>
              </Label>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="mt-1.5"
                required
              />
            </div>
          </div>

          {/* Usage Limit */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="limitUses">Limit Total Uses</Label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {isNew
                    ? "Restrict how many times this coupon can be used"
                    : "Usage limit type cannot be changed after creation"}
                </p>
              </div>
              <Switch
                id="limitUses"
                checked={formData.limitUses}
                onCheckedChange={(checked) => setFormData({ ...formData, limitUses: checked })}
                disabled={!isNew}
              />
            </div>

            {formData.limitUses && (
              <div>
                <Label htmlFor="limit">
                  Maximum Uses <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="limit"
                  type="number"
                  min="1"
                  value={formData.limit ?? ""}
                  onChange={(e) => setFormData({ ...formData, limit: Number(e.target.value) })}
                  placeholder="100"
                  className="mt-1.5"
                  required={formData.limitUses}
                  disabled={!isNew && !formData.limitUses}
                />
                {!isNew && (
                  <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    You can increase the limit, but cannot decrease it
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="isActive">Active</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Only active coupons can be used by customers
              </p>
            </div>
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigate("/admin/coupons");
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
                {isNew ? "Create Coupon" : "Save Changes"}
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
