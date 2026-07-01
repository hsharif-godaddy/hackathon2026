import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, User } from "lucide-react";
import { toast } from "sonner";

interface StaffMember {
  id: string;
  name: string | null;
  role: string;
  contact: { email: string | null; phone_number: string | null } | null;
  createdAt: string;
}

export default function AdminStaffDetailPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [staff, setStaff] = useState<StaffMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const res = await adminFetch(`/api/appointments/admin/staff/${id}`, token);
    if (res.ok) {
      const data = (await res.json()) as { staff: StaffMember };
      setStaff(data.staff);
      setName(data.staff.name ?? "");
      setRole(data.staff.role);
      setEmail(data.staff.contact?.email ?? "");
      setPhone(data.staff.contact?.phone_number ?? "");
    } else {
      toast.error("Staff member not found");
      void navigate("/admin/staff");
    }
    setLoading(false);
  }, [id, token, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!id) return;
    setSaving(true);
    const res = await adminFetch(`/api/appointments/admin/staff/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        name: name || undefined,
        role: role || undefined,
        email: email || undefined,
        phone_number: phone || undefined,
      }),
    });
    if (res.ok) {
      toast.success("Staff member updated");
      void load();
    } else {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      toast.error(d.message ?? "Failed to update");
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const initials = (staff?.name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigate("/admin/staff");
          }}
          className="-ml-2 mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Staff
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initials}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{staff?.name ?? "Staff Member"}</h1>
            <p className="text-sm text-muted-foreground">{staff?.role}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Details</h2>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. therapist, stylist"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Phone <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 000 0000"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => {
            void save();
          }}
          disabled={saving}
        >
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
