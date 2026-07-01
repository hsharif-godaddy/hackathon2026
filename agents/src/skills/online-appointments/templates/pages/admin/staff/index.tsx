import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, X, ChevronRight, Mail, Phone, AlertCircle } from "lucide-react";
import { StaffRoleBadge } from "@/components/admin/badges";
import { toast } from "sonner";

interface StaffMember {
  id: string;
  name: string | null;
  role: string;
  contact: { email: string | null; phone_number: string | null } | null;
  createdAt: string;
}

function AddStaffModal({
  token,
  onClose,
  onSaved,
}: {
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await adminFetch("/api/appointments/admin/staff", token, {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        phone_number: phone || undefined,
        role: role || "generic",
      }),
    });
    if (res.ok) {
      onSaved();
    } else {
      const d = (await res.json().catch(() => ({}))) as { message?: string };
      setError(d.message ?? "Failed to create staff member");
    }
    setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <h2 className="text-lg font-semibold text-foreground">Add Staff Member</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Role <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="e.g. therapist"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
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
          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void submit();
              }}
              disabled={submitting}
            >
              {submitting ? "Creating…" : "Create Staff Member"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  staff,
  token,
  onClose,
  onDeleted,
}: {
  staff: StaffMember;
  token: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setLoading(true);
    const res = await adminFetch(`/api/appointments/admin/staff/${staff.id}`, token, {
      method: "DELETE",
    });
    if (res.ok || res.status === 204) {
      onDeleted();
    } else {
      toast.error("Failed to remove staff member");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Remove staff member?</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{staff.name ?? "This staff member"}</span>{" "}
            will be permanently removed and unlinked from all services.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              void confirm();
            }}
            disabled={loading}
          >
            {loading ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminStaffPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch("/api/appointments/admin/staff?per_page=100", token);
    if (res.ok) {
      const data = (await res.json()) as { results?: StaffMember[] };
      setStaffMembers(data.results ?? []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {showAdd && (
        <AddStaffModal
          token={token}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          staff={deleteTarget}
          token={token}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void load();
          }}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staff</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {staffMembers.length} staff member{staffMembers.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Add staff
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Phone</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : staffMembers.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-muted-foreground">
                  <p className="mb-3">No staff members yet</p>
                  <Button size="sm" onClick={() => setShowAdd(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add your first staff member
                  </Button>
                </td>
              </tr>
            ) : (
              staffMembers.map((s) => (
                <tr
                  key={s.id}
                  className="group cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => {
                    void navigate(`/admin/staff/${s.id}`);
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(s.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">{s.name ?? "Unnamed"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StaffRoleBadge role={s.role} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.contact?.email ? (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        {s.contact.email}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.contact?.phone_number ? (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        {s.contact.phone_number}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-destructive opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        onClick={() => setDeleteTarget(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
