import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Edit, Trash2, Tag, Calendar } from "lucide-react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { formatCost } from "@/components/booking/service-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { toast } from "sonner";

interface Coupon {
  id: string;
  code: string;
  type: "PERCENTAGE" | "FIXED";
  discountPercentage?: number;
  discountPrice?: number;
  minimumCartValue: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  limitUses: boolean;
  limit?: number;
  currentUsage?: number;
  createdAt: string;
}

export default function AdminCouponsPage() {
  const { token } = useAdminAuth();
  const { currency } = useAppConfig();
  const navigate = useNavigate();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadCoupons() {
    try {
      setLoading(true);
      const res = await adminFetch("/api/appointments/admin/coupons", token);
      if (res.ok) {
        const data = (await res.json()) as { coupons?: Coupon[] };
        setCoupons(data.coupons ?? []);
      } else {
        toast.error("Failed to load coupons");
      }
    } catch (error) {
      toast.error("Error loading coupons");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCoupons is not memoized; token covers its reactive dependency
  }, [token]);

  async function handleDelete(id: string, code: string) {
    if (!confirm(`Are you sure you want to delete coupon "${code}"?`)) {
      return;
    }

    try {
      setDeletingId(id);
      const res = await adminFetch(`/api/appointments/admin/coupons/${id}`, token, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Coupon deleted successfully");
        await loadCoupons();
      } else {
        const errorData = (await res.json()) as { message?: string };
        toast.error(errorData.message ?? "Failed to delete coupon");
      }
    } catch (error) {
      toast.error("Error deleting coupon");
      console.error(error);
    } finally {
      setDeletingId(null);
    }
  }

  const filteredCoupons = coupons.filter((coupon) =>
    coupon.code.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  function formatDiscount(coupon: Coupon) {
    if (coupon.type === "PERCENTAGE") {
      return `${coupon.discountPercentage}% off`;
    }
    return `${formatCost(String((coupon.discountPrice ?? 0) / 100), currency)} off`;
  }

  function formatMinCart(amount: number) {
    if (amount === 0) return "No minimum";
    return `Min: ${formatCost(String(amount / 100), currency)}`;
  }

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Coupons</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage discount coupons for your business
          </p>
        </div>
        <Button onClick={() => void navigate("/admin/coupons/new")} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Coupon
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search coupons by code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Coupons List */}
      {loading ? (
        <div className="space-y-4">
          {[...Array<unknown>(3)].map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filteredCoupons.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <Tag className="mx-auto mb-4 h-12 w-12 text-zinc-400" />
          <h3 className="mb-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {searchTerm ? "No coupons found" : "No coupons yet"}
          </h3>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {searchTerm
              ? "Try adjusting your search"
              : "Create your first coupon to offer discounts"}
          </p>
          {!searchTerm && (
            <Button onClick={() => void navigate("/admin/coupons/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create Coupon
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCoupons.map((coupon) => (
            <div
              key={coupon.id}
              className="rounded-xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between">
                {/* Left: Coupon Info */}
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                      {coupon.code}
                    </h3>
                    <Badge
                      variant={coupon.isActive ? "default" : "secondary"}
                      className={
                        coupon.isActive
                          ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                          : ""
                      }
                    >
                      {coupon.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <Badge variant="outline">{coupon.type}</Badge>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Discount</p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {formatDiscount(coupon)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Minimum Cart</p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {formatMinCart(coupon.minimumCartValue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Valid Period</p>
                      <p className="flex items-center gap-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(coupon.startDate), "MMM d")} -{" "}
                        {format(new Date(coupon.endDate), "MMM d, yyyy")}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Usage</p>
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {coupon.limitUses
                          ? `${coupon.currentUsage ?? 0} / ${coupon.limit}`
                          : `${coupon.currentUsage ?? 0} (Unlimited)`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="ml-4 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void navigate(`/admin/coupons/${coupon.id}`)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleDelete(coupon.id, coupon.code)}
                    disabled={deletingId === coupon.id}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
