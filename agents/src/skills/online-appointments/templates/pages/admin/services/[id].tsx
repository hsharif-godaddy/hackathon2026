import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Save, CheckCircle, CalendarDays, Repeat } from "lucide-react";
import { getPublicConfig } from "@/lib/api-client";
import { useAppConfig } from "@/contexts/AppConfigContext";
import { formatCost } from "@/components/booking/service-utils";

interface Service {
  id: string;
  name: string;
  slug: string;
  duration: string | null;
  cost: string | null;
  visible: boolean | null;
  capacity: number | null;
  description: string | null;
  bufferTime: string | null;
  bookLeadTime: string | null;
  recurrenceType: string | null;
  schedule: string | null;
  startTime: string | null;
  endTime: string | null;
  recurrenceLimit: number | null;
  imageUrl: string | null;
}

interface StaffInfo {
  id: string;
  role: string;
  name?: string;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-3 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function fromIsoDuration(iso: string | null): string {
  if (!iso) return "60";
  if (!iso.startsWith("PT")) return "60";
  const hourMatch = iso.match(/(\d+)H/);
  const minuteMatch = iso.match(/(\d+)M/);
  const hours = parseInt(hourMatch?.[1] ?? "0");
  const mins = parseInt(minuteMatch?.[1] ?? "0");
  return String(hours * 60 + mins);
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
  { key: 1, label: "Mon" },
  { key: 2, label: "Tue" },
  { key: 3, label: "Wed" },
  { key: 4, label: "Thu" },
  { key: 5, label: "Fri" },
  { key: 6, label: "Sat" },
  { key: 0, label: "Sun" },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface RRule {
  rule_type?: string;
  interval?: number;
  validations?: {
    day_of_week?: number[];
    hour_of_day?: number[];
  };
}

interface ParsedSchedule {
  start_time?: string;
  end_time?: string;
  rrules?: RRule[];
}

interface ServiceApiData {
  service?: Service;
  staff?: StaffInfo;
}

interface CountApiData {
  count?: number;
  total?: number;
}

interface SaveApiData {
  service?: Service;
}

interface SaveErrorData {
  message?: string;
}

function ScheduleDisplay({
  schedule,
  startTime,
  recurrenceLimit,
  timezone,
}: {
  schedule: string | null;
  startTime: string | null;
  recurrenceLimit: number | null;
  timezone: string;
}) {
  if (!schedule) return null;

  let parsed: ParsedSchedule;
  try {
    parsed = JSON.parse(schedule) as ParsedSchedule;
  } catch {
    return null;
  }

  const rule = parsed.rrules?.[0];
  const repeatType = rule?.rule_type ?? "weekly";
  const daysOfWeek = rule?.validations?.day_of_week ?? [];
  const hourOfDay = rule?.validations?.hour_of_day?.[0];

  const startDateStr = startTime
    ? new Date(startTime).toLocaleDateString([], {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: timezone,
      })
    : parsed.start_time
      ? new Date(parsed.start_time).toLocaleDateString([], {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: timezone,
        })
      : "—";
  const timeStr =
    hourOfDay !== undefined
      ? `${String(hourOfDay).padStart(2, "0")}:00`
      : startTime
        ? new Date(startTime).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            timeZone: timezone,
          })
        : "—";

  const endTimeStr =
    parsed.end_time && parsed.end_time !== "2030-12-31T23:59:59"
      ? new Date(parsed.end_time).toLocaleDateString([], {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: timezone,
        })
      : null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
        <Repeat className="h-4 w-4" /> Recurrence Schedule
      </h2>
      <Row label="Starts" value={startDateStr} />
      <Row label="Time" value={timeStr} />
      <Row label="Repeats" value={repeatType.charAt(0).toUpperCase() + repeatType.slice(1)} />
      {repeatType === "weekly" && daysOfWeek.length > 0 && (
        <Row
          label="On"
          value={
            <div className="flex flex-wrap gap-1.5">
              {DAY_NAMES.map((name, i) => (
                <span
                  key={name}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium",
                    daysOfWeek.includes(i)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {name}
                </span>
              ))}
            </div>
          }
        />
      )}
      {endTimeStr && <Row label="Ends" value={endTimeStr} />}
      {recurrenceLimit && <Row label="Ends after" value={`${recurrenceLimit} occurrences`} />}
    </div>
  );
}

export default function AdminServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAdminAuth();
  const { currency } = useAppConfig();
  const navigate = useNavigate();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [bookingsCount, setBookingsCount] = useState<number | null>(null);
  const [staffInfo, setStaffInfo] = useState<StaffInfo | null>(null);
  const [timezone, setTimezone] = useState("UTC");

  useEffect(() => {
    getPublicConfig()
      .then((c) => setTimezone(c.config.timezone ?? "UTC"))
      .catch(() => undefined);
  }, []);

  const [scheduleType, setScheduleType] = useState<"business_hours" | "custom">("business_hours");
  const [duration, setDuration] = useState("60");
  const [bufferTime, setBufferTime] = useState("0");
  const [leadTime, setLeadTime] = useState("0");
  const [capacity, setCapacity] = useState("1");
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [customStartTime, setCustomStartTime] = useState("09:00");
  const [customEndTime, setCustomEndTime] = useState("17:00");
  const [savingAvail, setSavingAvail] = useState(false);
  const [savedAvail, setSavedAvail] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [svcRes, countRes] = await Promise.all([
        adminFetch(`/api/appointments/admin/services/${id}`, token),
        adminFetch(`/api/appointments/admin/services/${id}/bookings-count`, token),
      ]);
      if (svcRes.ok) {
        const d = (await svcRes.json()) as ServiceApiData;
        const svc = d.service ?? (d as unknown as Service);
        setService(svc);
        initAvailabilityForm(svc);
        if (d.staff) setStaffInfo(d.staff);
      }
      if (countRes.ok) {
        const d = (await countRes.json()) as CountApiData;
        setBookingsCount(d.count ?? d.total ?? null);
      }
      setLoading(false);
    }
    void load();
  }, [id, token]);

  function initAvailabilityForm(svc: Service) {
    setScheduleType(svc.recurrenceType === "business_hours" ? "business_hours" : "custom");
    setDuration(fromIsoDuration(svc.duration));
    setBufferTime(fromIsoDuration(svc.bufferTime));
    setLeadTime(fromIsoDuration(svc.bookLeadTime));
    setCapacity(String(svc.capacity ?? 1));

    if (svc.schedule && svc.recurrenceType !== "business_hours") {
      try {
        const schedule = JSON.parse(svc.schedule) as ParsedSchedule;
        const rule = schedule.rrules?.[0];
        if (rule?.validations?.day_of_week) {
          setCustomDays(rule.validations.day_of_week);
        }
        if (rule?.validations?.hour_of_day?.length) {
          const sortedHours = [...rule.validations.hour_of_day].sort((a, b) => a - b);
          const firstHour = sortedHours[0];
          const lastHour = sortedHours[sortedHours.length - 1];
          if (firstHour !== undefined) {
            setCustomStartTime(`${String(firstHour).padStart(2, "0")}:00`);
          }
          if (lastHour !== undefined) {
            setCustomEndTime(`${String(lastHour + 1).padStart(2, "0")}:00`);
          }
        }
      } catch {
        /* use defaults */
      }
    }
  }

  function toggleDay(day: number) {
    setCustomDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  function buildScheduleJson(): string {
    const startHour = parseInt(customStartTime.split(":")[0] ?? "0");
    const endHour = parseInt(customEndTime.split(":")[0] ?? "0");
    const hours: number[] = [];
    for (let h = startHour; h < endHour; h++) hours.push(h);

    return JSON.stringify({
      start_time: "2024-01-01T00:00:00",
      end_time: "2030-12-31T23:59:59",
      rrules: [
        {
          rule_type: "weekly",
          interval: 1,
          validations: {
            day_of_week: customDays,
            hour_of_day: hours,
          },
        },
      ],
    });
  }

  async function saveAvailability() {
    if (!service) return;
    setSavingAvail(true);
    setAvailError(null);

    const isEvent =
      service.recurrenceType === "one_time" || service.recurrenceType === "recurring_event";

    const body: Record<string, unknown> = {
      duration: toIsoDuration(duration),
      buffer_time: toIsoDuration(bufferTime),
      book_lead_time: toIsoDuration(leadTime),
      capacity: parseInt(capacity) || 1,
    };

    if (!isEvent) {
      body.recurrence_type = scheduleType;
      if (scheduleType === "custom") body.schedule = buildScheduleJson();
      else body.schedule = null;
    }

    const res = await adminFetch(`/api/appointments/admin/services/${service.id}`, token, {
      method: "PATCH",
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setSavedAvail(true);
      setTimeout(() => setSavedAvail(false), 2000);
      const d = (await res.json()) as SaveApiData;
      const updated = d.service ?? (d as unknown as Service);
      setService(updated);
    } else {
      const d = (await res.json().catch(() => null)) as SaveErrorData | null;
      setAvailError(d?.message ?? "Failed to save");
    }
    setSavingAvail(false);
  }

  if (loading) {
    return (
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Service not found</p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => {
            void navigate("/admin/services");
          }}
        >
          Back to services
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void navigate("/admin/services");
          }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-foreground">{service.name}</h1>
          <p className="text-sm text-muted-foreground">/{service.slug}</p>
        </div>
      </div>

      {service.imageUrl && (
        <div className="overflow-hidden rounded-xl border border-border">
          <img
            src={service.imageUrl}
            alt={service.name}
            className="h-48 w-full object-cover"
          />
        </div>
      )}

      {service.description && (
        <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
          {service.description}
        </p>
      )}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-3 font-semibold text-foreground">Configuration</h2>
        <Row
          label="Type"
          value={
            service.recurrenceType === "one_time"
              ? "One-time Event"
              : service.recurrenceType === "recurring_event"
                ? "Recurring Event"
                : "Appointment"
          }
        />
        <Row label="Duration" value={fromIsoDuration(service.duration) + " min"} />
        <Row label="Cost" value={formatCost(service.cost, currency)} />
        <Row label="Capacity" value={service.capacity ?? 1} />
        <Row label="Visible" value={service.visible ? "Yes" : "No"} />
        <Row
          label="Staff"
          value={
            staffInfo
              ? (staffInfo.name ?? staffInfo.role)
              : "None"
          }
        />
        {bookingsCount !== null && <Row label="Total Bookings" value={bookingsCount} />}
      </div>

      {service.recurrenceType === "one_time" && service.startTime && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-foreground">
            <CalendarDays className="h-4 w-4" /> Event Schedule
          </h2>
          <Row
            label="Event Date"
            value={new Date(service.startTime).toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: timezone,
            })}
          />
          <Row
            label="Event Time"
            value={new Date(service.startTime).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
              timeZone: timezone,
            })}
          />
          {service.endTime && (
            <Row
              label="End Time"
              value={new Date(service.endTime).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
                timeZone: timezone,
              })}
            />
          )}
        </div>
      )}

      {service.recurrenceType === "recurring_event" && (
        <ScheduleDisplay
          schedule={service.schedule}
          startTime={service.startTime}
          recurrenceLimit={service.recurrenceLimit}
          timezone={timezone}
        />
      )}

      {/* Availability Settings */}
      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold text-foreground">Availability Settings</h2>

        <div className="space-y-2">
          <Label className="text-foreground">Schedule Type</Label>
          <div className="flex gap-4">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="scheduleType"
                checked={scheduleType === "business_hours"}
                onChange={() => setScheduleType("business_hours")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Business Hours</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="scheduleType"
                checked={scheduleType === "custom"}
                onChange={() => setScheduleType("custom")}
                className="accent-primary"
              />
              <span className="text-sm text-foreground">Custom Schedule</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-foreground">Duration (minutes)</Label>
            <Input
              type="number"
              min="5"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground">Buffer Time (minutes)</Label>
            <Input
              type="number"
              min="0"
              value={bufferTime}
              onChange={(e) => setBufferTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground">Lead Time (minutes)</Label>
            <Input
              type="number"
              min="0"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-foreground">Capacity</Label>
            <Input
              type="number"
              min="1"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>

        {scheduleType === "custom" && (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="space-y-2">
              <Label className="text-foreground">Available Days</Label>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => toggleDay(key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      customDays.includes(key)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-foreground">Available Hours</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={customStartTime}
                  onChange={(e) => setCustomStartTime(e.target.value)}
                  className="w-32"
                />
                <span className="text-muted-foreground">—</span>
                <Input
                  type="time"
                  value={customEndTime}
                  onChange={(e) => setCustomEndTime(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
          </div>
        )}

        {availError && <p className="text-sm text-destructive">{availError}</p>}

        <Button
          onClick={() => {
            void saveAvailability();
          }}
          disabled={savingAvail}
        >
          {savedAvail ? (
            <>
              <CheckCircle className="mr-2 h-4 w-4 text-green-500" />
              Saved
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              {savingAvail ? "Saving…" : "Save Availability"}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
