import { useCallback, useEffect, useState } from "react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { formatCost } from "@/components/booking/service-utils";
import { ServiceTypeBadge, StaffRoleBadge } from "@/components/admin/badges";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Clock,
  DollarSign,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  X,
  AlertCircle,
  CalendarDays,
  Repeat,
  User,
  ChevronRight,
} from "lucide-react";

interface StaffMember {
  id: string;
  role: string;
  name?: string;
}

interface Service {
  id: string;
  name: string;
  slug: string;
  duration: string | null;
  cost: string | null;
  visible: boolean | null;
  capacity: number | null;
  description: string | null;
  recurrenceType: string | null;
  staffRole: string | null;
}

type ServiceType = "appointment" | "one_time" | "recurring";

function formatDuration(iso: string | null): string {
  if (!iso) return "—";
  // eslint-disable-next-line security/detect-unsafe-regex
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return iso;
  const h = parseInt(m[1] ?? "0");
  const min = parseInt(m[2] ?? "0");
  if (h && min) return `${h}h ${min}m`;
  if (h) return `${h}h`;
  return `${min}m`;
}

function toIsoDuration(val: string): string {
  if (!val) return "PT60M";
  if (val.startsWith("PT")) return val;
  const mins = parseInt(val);
  if (isNaN(mins)) return "PT60M";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `PT${h}H${m > 0 ? `${m}M` : ""}` : `PT${m}M`;
}

const WEEK_DAYS = [
  { key: 0, label: "Sun" },
  { key: 1, label: "Mon" },
  { key: 2, label: "Tue" },
  { key: 3, label: "Wed" },
  { key: 4, label: "Thu" },
  { key: 5, label: "Fri" },
  { key: 6, label: "Sat" },
];

function TypeSelector({ onSelect }: { onSelect: (type: ServiceType) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">What type of service do you want to create?</p>
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => onSelect("appointment")}
          className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 transition-colors hover:border-border/80 hover:bg-accent/50"
        >
          <User className="h-6 w-6 text-green-600 dark:text-green-400" />
          <span className="text-sm font-medium text-foreground">1-1 Appointment</span>
          <span className="text-center text-xs text-muted-foreground">Uses business hours</span>
        </button>
        <button
          onClick={() => onSelect("one_time")}
          className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 transition-colors hover:border-border/80 hover:bg-accent/50"
        >
          <CalendarDays className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium text-foreground">One-time Event</span>
          <span className="text-center text-xs text-muted-foreground">Single occurrence</span>
        </button>
        <button
          onClick={() => onSelect("recurring")}
          className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 transition-colors hover:border-border/80 hover:bg-accent/50"
        >
          <Repeat className="h-6 w-6 text-purple-600 dark:text-purple-400" />
          <span className="text-sm font-medium text-foreground">Recurring Event</span>
          <span className="text-center text-xs text-muted-foreground">Weekly, monthly, yearly</span>
        </button>
      </div>
    </div>
  );
}

function StaffRoleSelect({
  staffMembers,
  value,
  onChange,
}: {
  staffMembers: StaffMember[];
  value: string;
  onChange: (v: string) => void;
}) {
  const roles = [...new Set(staffMembers.map((s) => s.role))].sort();
  if (roles.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Label>
        Staff Role <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
      >
        <option value="">No role assigned</option>
        {roles.map((role) => {
          const count = staffMembers.filter((s) => s.role === role).length;
          return (
            <option key={role} value={role}>
              {role} ({count} staff)
            </option>
          );
        })}
      </select>
      {value && (
        <p className="text-xs text-muted-foreground">
          Any staff member with the &quot;{value}&quot; role can provide this service.
        </p>
      )}
    </div>
  );
}

function LocationSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Service Location</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
      >
        <option value="business_location">Business Location</option>
        <option value="custom">Custom Location</option>
        <option value="virtual">Virtual / Online</option>
      </select>
    </div>
  );
}

function AppointmentForm({
  token,
  staffMembers,
  onClose,
  onSaved,
}: {
  token: string | null;
  staffMembers: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("60");
  const [cost, setCost] = useState("");
  const [capacity, setCapacity] = useState("1");
  const [bufferTime, setBufferTime] = useState("0");
  const [leadTime, setLeadTime] = useState("0");
  const [locationType, setLocationType] = useState("business_location");
  const [staffRole, setStaffRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await adminFetch("/api/appointments/admin/services/appointment", token, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || undefined,
        duration: toIsoDuration(duration),
        cost: cost || undefined,
        capacity: parseInt(capacity) || 1,
        buffer_time: toIsoDuration(bufferTime),
        book_lead_time: toIsoDuration(leadTime),
        location_type: locationType,
        staff_role: staffRole || undefined,
      }),
    });

    if (res.ok) {
      onSaved();
    } else {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message ?? d.error ?? "Failed to create");
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 60-Minute Consultation"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Brief description"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Duration (minutes) *</Label>
          <Input
            type="number"
            min="5"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Capacity</Label>
          <Input
            type="number"
            min="1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Buffer (min)</Label>
          <Input
            type="number"
            min="0"
            value={bufferTime}
            onChange={(e) => setBufferTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Lead time (min)</Label>
          <Input
            type="number"
            min="0"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
          />
        </div>
      </div>
      <LocationSelect value={locationType} onChange={setLocationType} />
      <StaffRoleSelect staffMembers={staffMembers} value={staffRole} onChange={setStaffRole} />
      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void submit();
          }}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "Create Appointment"}
        </Button>
      </div>
    </div>
  );
}

function OneTimeEventForm({
  token,
  staffMembers,
  onClose,
  onSaved,
}: {
  token: string | null;
  staffMembers: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [duration, setDuration] = useState("60");
  const [maxParticipants, setMaxParticipants] = useState("30");
  const [cost, setCost] = useState("");
  const [locationType, setLocationType] = useState("business_location");
  const [staffRole, setStaffRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!eventDate) {
      setError("Event date is required");
      return;
    }
    if (!eventTime) {
      setError("Event time is required");
      return;
    }
    setSubmitting(true);
    setError(null);

    const res = await adminFetch("/api/appointments/admin/services/one-time-event", token, {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description || undefined,
        event_date: eventDate,
        event_time: eventTime,
        duration: toIsoDuration(duration),
        max_participants: parseInt(maxParticipants) || 30,
        cost: cost || undefined,
        location_type: locationType,
        staff_role: staffRole || undefined,
      }),
    });

    if (res.ok) {
      onSaved();
    } else {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message ?? d.error ?? "Failed to create");
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Workshop: Intro to Painting"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Brief description"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">Event Schedule</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Event Date *</Label>
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Event Time *</Label>
            <Input type="time" value={eventTime} onChange={(e) => setEventTime(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Duration (minutes) *</Label>
          <Input
            type="number"
            min="5"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Maximum Participants *</Label>
          <Input
            type="number"
            min="1"
            max="300"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Enter a number between 1 and 300</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>
      <LocationSelect value={locationType} onChange={setLocationType} />
      <StaffRoleSelect staffMembers={staffMembers} value={staffRole} onChange={setStaffRole} />
      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void submit();
          }}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "Create Event"}
        </Button>
      </div>
    </div>
  );
}

function RecurringEventForm({
  token,
  staffMembers,
  onClose,
  onSaved,
}: {
  token: string | null;
  staffMembers: StaffMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTimeOfDay, setStartTimeOfDay] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [repeat, setRepeat] = useState<"weekly" | "monthly" | "yearly">("weekly");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [endType, setEndType] = useState<"by_date" | "by_count">("by_date");
  const [endDate, setEndDate] = useState("");
  const [endOccurrences, setEndOccurrences] = useState("10");
  const [cost, setCost] = useState("");
  const [capacity, setCapacity] = useState("15");
  const [locationType, setLocationType] = useState("business_location");
  const [staffRole, setStaffRole] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  async function submit() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!startDate) {
      setError("Start date is required");
      return;
    }
    if (repeat === "weekly" && daysOfWeek.length === 0) {
      setError("Select at least one day");
      return;
    }
    if (endType === "by_date" && !endDate) {
      setError("End date is required");
      return;
    }
    setSubmitting(true);
    setError(null);

    const body: Record<string, unknown> = {
      name,
      description: description || undefined,
      start_date: startDate,
      start_time_of_day: startTimeOfDay,
      duration: toIsoDuration(duration),
      repeat,
      end_type: endType,
      cost: cost || undefined,
      capacity: parseInt(capacity) || 15,
      location_type: locationType,
      staff_role: staffRole || undefined,
    };

    if (repeat === "weekly") body.days_of_week = daysOfWeek;
    if (endType === "by_date") body.end_date = endDate;
    else body.end_occurrences = parseInt(endOccurrences) || 10;

    const res = await adminFetch("/api/appointments/admin/services/recurring-event", token, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (res.ok) {
      onSaved();
    } else {
      const d = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setError(d.message ?? d.error ?? "Failed to create");
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Name *</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Yoga Class"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Description</Label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Brief description"
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="space-y-4 rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium text-foreground">Recurrence</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Start *</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Time *</Label>
            <Input
              type="time"
              value={startTimeOfDay}
              onChange={(e) => setStartTimeOfDay(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Repeat *</Label>
          <select
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as "weekly" | "monthly" | "yearly")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        {repeat === "weekly" && (
          <div className="space-y-1.5">
            <Label>On *</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEK_DAYS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleDay(key)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    daysOfWeek.includes(key)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>End *</Label>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={endType === "by_date"}
                onChange={() => setEndType("by_date")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">By</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                disabled={endType !== "by_date"}
                className="w-40"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={endType === "by_count"}
                onChange={() => setEndType("by_count")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">By</span>
              <Input
                type="number"
                min="1"
                value={endOccurrences}
                onChange={(e) => setEndOccurrences(e.target.value)}
                disabled={endType !== "by_count"}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">occurrences</span>
            </label>
          </div>
        </div>

        {!startDate && (
          <p className="text-xs text-muted-foreground">Set a start date to preview the series.</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Duration (min) *</Label>
          <Input
            type="number"
            min="5"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Price</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Capacity</Label>
          <Input
            type="number"
            min="1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
      </div>
      <LocationSelect value={locationType} onChange={setLocationType} />
      <StaffRoleSelect staffMembers={staffMembers} value={staffRole} onChange={setStaffRole} />
      {error && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void submit();
          }}
          disabled={submitting}
        >
          {submitting ? "Creating…" : "Create Recurring Event"}
        </Button>
      </div>
    </div>
  );
}

function CreateServiceModal({
  token,
  onClose,
  onSaved,
}: {
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<"select" | ServiceType>("select");
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);

  useEffect(() => {
    async function loadResources() {
      const res = await adminFetch("/api/appointments/admin/staff", token);
      if (res.ok) {
        const data = (await res.json()) as { results?: StaffMember[] };
        setStaffMembers(data.results ?? []);
      }
    }
    void loadResources();
  }, [token]);

  const title =
    step === "select"
      ? "Create Service"
      : step === "appointment"
        ? "New 1-1 Appointment"
        : step === "one_time"
          ? "New One-time Event"
          : "New Recurring Event";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 pb-4 pt-5">
          <div className="flex items-center gap-2">
            {step !== "select" && (
              <button
                onClick={() => setStep("select")}
                className="rounded p-1 transition-colors hover:bg-muted"
              >
                <X
                  className="h-3.5 w-3.5 rotate-0 text-muted-foreground"
                  style={{ transform: "rotate(180deg) scaleX(-1)" }}
                />
              </button>
            )}
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="px-6 py-5">
          {step === "select" && <TypeSelector onSelect={setStep} />}
          {step === "appointment" && (
            <AppointmentForm
              token={token}
              staffMembers={staffMembers}
              onClose={onClose}
              onSaved={onSaved}
            />
          )}
          {step === "one_time" && (
            <OneTimeEventForm
              token={token}
              staffMembers={staffMembers}
              onClose={onClose}
              onSaved={onSaved}
            />
          )}
          {step === "recurring" && (
            <RecurringEventForm
              token={token}
              staffMembers={staffMembers}
              onClose={onClose}
              onSaved={onSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  service,
  token,
  onClose,
  onDeleted,
}: {
  service: Service;
  token: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setLoading(true);
    const res = await adminFetch(`/api/appointments/admin/services/${service.id}`, token, {
      method: "DELETE",
    });
    if (res.ok) {
      onDeleted();
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "Failed to delete service");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Delete service?</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{service.name}</span> will be permanently
            removed.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
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
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function AdminServicesPage() {
  const { token } = useAdminAuth();
  const { currency } = useAppConfig();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await adminFetch("/api/appointments/admin/services?per_page=100", token);
    if (res.ok) {
      const data = (await res.json()) as { results?: Service[] };
      setServices(data.results ?? []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {showCreate && (
        <CreateServiceModal
          token={token}
          onClose={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {deleteTarget && (
        <DeleteConfirm
          service={deleteTarget}
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
          <h1 className="text-2xl font-bold text-foreground">Services</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {services.length} services configured
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Add service
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Duration</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Price</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Staff Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Visible</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <td colSpan={7} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            ) : services.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted-foreground">
                  <p className="mb-3">No services yet</p>
                  <Button size="sm" onClick={() => setShowCreate(true)}>
                    <Plus className="mr-1.5 h-4 w-4" /> Add your first service
                  </Button>
                </td>
              </tr>
            ) : (
              services.map((s) => {
                return (
                  <tr
                    key={s.id}
                    className="group cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => {
                      window.location.href = `/admin/services/${s.id}`;
                    }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{s.name}</p>
                      {s.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {s.description}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ServiceTypeBadge recurrenceType={s.recurrenceType} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5 shrink-0" />
                        {formatDuration(s.duration)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {s.cost ? (
                        <span>{formatCost(s.cost, currency)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.staffRole ? (
                        <StaffRoleBadge role={s.staffRole} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.visible ? (
                        <Eye className="h-4 w-4 text-green-500" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-muted-foreground" />
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
