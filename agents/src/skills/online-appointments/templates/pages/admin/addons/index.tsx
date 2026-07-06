import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Edit, Trash2, Package, Clock, DollarSign } from "lucide-react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

interface Addon {
  id: string;
  title: string;
  description: string | null;
  price: string;
  duration: string;
  active: boolean;
  createdAt: string;
}
interface AddonsResponse {
  addons: Addon[];
}

interface ErrorResponse {
  message?: string;
}

function formatDuration(iso: string): string {
  // eslint-disable-next-line security/detect-unsafe-regex
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return "—";
  const h = parseInt(m[1] ?? "0", 10);
  const min = parseInt(m[2] ?? "0", 10);
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  if (min) return `${min}m`;
  return "None";
}

function formatPrice(price: string): string {
  const n = parseFloat(price);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
}

export default function AdminAddonsPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAddons = useCallback(async () => {
    try {
      setLoading(true);

      const res = await adminFetch("/api/appointments/admin/addons", token);

      if (!res.ok) {
        toast.error("Failed to load add-ons");
        return;
      }

      // Fix lines 63–64: cast res.json() to the known type to avoid `any`
      // assignment; drop `?? []` which was flagged as unnecessary because
      // AddonsResponse guarantees `addons` is already Addon[].
      const data = (await res.json()) as AddonsResponse;
      setAddons(data.addons);
    } catch (error) {
      toast.error("Error loading add-ons");
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAddons();
  }, [loadAddons]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Are you sure you want to delete add-on "${title}"?`)) {
      return;
    }

    try {
      setDeletingId(id);
      const res = await adminFetch(`/api/appointments/admin/addons/${id}`, token, {
        method: "DELETE",
      });

      if (res.ok) {
        toast.success("Add-on deleted successfully");
        await loadAddons();
      } else {
        // Fix line 92: cast res.json() to the known type instead of letting
        // it be inferred as `any`.
        const error = (await res.json().catch((): ErrorResponse => ({}))) as ErrorResponse;

        toast.error(error.message ?? "Failed to delete add-on");
      }
    } catch (error) {
      toast.error("Error deleting add-on");
      console.error(error);
    } finally {
      setDeletingId(null);
    }
  }

  const filteredAddons = addons.filter((addon) =>
    addon.title.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">Add-ons</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage optional paid extras you can attach to services
          </p>
        </div>
        {/* Fix line 120: navigate() is synchronous; wrap to satisfy void onClick */}
        <Button
          onClick={() => {
            void navigate("/admin/addons/new");
          }}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Add-on
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search add-ons by name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Add-ons List */}
      {loading ? (
        <div className="space-y-4">
          {["s1", "s2", "s3"].map((key) => (
            <Skeleton key={key} className="h-28 w-full" />
          ))}
        </div>
      ) : filteredAddons.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <Package className="mx-auto mb-4 h-12 w-12 text-zinc-400" />
          <h3 className="mb-2 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {searchTerm ? "No add-ons found" : "No add-ons yet"}
          </h3>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {searchTerm
              ? "Try adjusting your search"
              : "Create your first add-on, then assign it to a service"}
          </p>
          {!searchTerm && (
            /* Fix line 159: same void-wrap pattern */
            <Button
              onClick={() => {
                void navigate("/admin/addons/new");
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create Add-on
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAddons.map((addon) => (
            <div
              key={addon.id}
              className="rounded-xl border border-zinc-200 bg-white p-6 transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="truncate text-xl font-bold text-zinc-900 dark:text-zinc-100">
                      {addon.title}
                    </h3>
                    <Badge
                      variant={addon.active ? "default" : "secondary"}
                      className={
                        addon.active
                          ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
                          : ""
                      }
                    >
                      {addon.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>

                  {addon.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {addon.description}
                    </p>
                  )}

                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <DollarSign className="h-4 w-4 text-zinc-400" />
                      {formatPrice(addon.price)}
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                      <Clock className="h-4 w-4 text-zinc-400" />
                      {formatDuration(addon.duration)}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="ml-4 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void navigate(`/admin/addons/${addon.id}`);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {/* Fix line 213: void-wrap the async handleDelete call */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      void handleDelete(addon.id, addon.title);
                    }}
                    disabled={deletingId === addon.id}
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
