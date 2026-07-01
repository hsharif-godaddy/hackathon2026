import { useEffect, useState } from "react";
import { useAdminAuth, adminFetch } from "@/contexts/AdminAuthContext";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, CheckCircle, Plus, X } from "lucide-react";

interface TimeBlock {
  startTime: string;
  endTime: string;
}

interface DayConfig {
  active: boolean;
  timeBlocks: TimeBlock[];
}

type BusinessHours = Record<string, DayConfig>;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

const DEFAULT_BLOCK: TimeBlock = { startTime: "09:00", endTime: "17:00" };

interface AvailabilityData {
  business_hours: BusinessHours;
}

export default function AdminAvailabilityPage() {
  const { token } = useAdminAuth();
  const [hours, setHours] = useState<BusinessHours | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await adminFetch("/api/appointments/admin/availability", token);
      if (res.ok) {
        const data = (await res.json()) as AvailabilityData;
        setHours(data.business_hours);
      } else {
        setError("Failed to load business hours");
      }
      setLoading(false);
    }
    void load();
  }, [token]);

  function toggleDay(day: string) {
    if (!hours) return;
    const dayConfig = hours[day];
    if (!dayConfig) return;
    setHours({
      ...hours,
      [day]: {
        ...dayConfig,
        active: !dayConfig.active,
        timeBlocks:
          !dayConfig.active && dayConfig.timeBlocks.length === 0
            ? [{ ...DEFAULT_BLOCK }]
            : dayConfig.timeBlocks,
      },
    });
  }

  function updateBlock(day: string, index: number, field: keyof TimeBlock, value: string) {
    if (!hours) return;
    const dayConfig = hours[day];
    if (!dayConfig) return;
    const blocks = [...dayConfig.timeBlocks];
    const block = blocks[index];
    if (!block) return;
    blocks[index] = { ...block, [field]: value };
    setHours({ ...hours, [day]: { ...dayConfig, timeBlocks: blocks } });
  }

  function addBlock(day: string) {
    if (!hours) return;
    const dayConfig = hours[day];
    if (!dayConfig) return;
    const blocks = [...dayConfig.timeBlocks];
    const lastBlock = blocks.length > 0 ? blocks[blocks.length - 1] : null;
    const lastEnd = lastBlock ? lastBlock.endTime : "09:00";
    blocks.push({ startTime: lastEnd, endTime: "17:00" });
    setHours({ ...hours, [day]: { ...dayConfig, timeBlocks: blocks } });
  }

  function removeBlock(day: string, index: number) {
    if (!hours) return;
    const dayConfig = hours[day];
    if (!dayConfig) return;
    const blocks = dayConfig.timeBlocks.filter((_, i) => i !== index);
    setHours({ ...hours, [day]: { ...dayConfig, timeBlocks: blocks } });
  }

  async function save() {
    if (!hours) return;
    setSaving(true);
    setError(null);
    const res = await adminFetch("/api/appointments/admin/availability", token, {
      method: "PUT",
      body: JSON.stringify(hours),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      setError(data?.message ?? "Failed to save");
    }
    setSaving(false);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Business Hours</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure when your business is available for appointments
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={DAYS[i] ?? i} className="h-12 w-full" />
            ))}
          </div>
        ) : hours ? (
          <>
            {DAYS.map((day) => {
              const dayConfig = hours[day];
              if (!dayConfig) return null;
              return (
                <div key={day} className="border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <Switch checked={dayConfig.active} onCheckedChange={() => toggleDay(day)} />
                    <Label className="w-24 text-sm font-medium text-foreground">
                      {DAY_LABELS[day]}
                    </Label>
                    {!dayConfig.active && (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </div>

                  {dayConfig.active && (
                    <div className="ml-14 mt-2 space-y-2">
                      {dayConfig.timeBlocks.map((block, idx) => (
                        <div
                          key={`${day}-${block.startTime}-${block.endTime}`}
                          className="flex items-center gap-2"
                        >
                          <Input
                            type="time"
                            value={block.startTime}
                            onChange={(e) => updateBlock(day, idx, "startTime", e.target.value)}
                            className="w-32"
                          />
                          <span className="text-muted-foreground">—</span>
                          <Input
                            type="time"
                            value={block.endTime}
                            onChange={(e) => updateBlock(day, idx, "endTime", e.target.value)}
                            className="w-32"
                          />
                          {dayConfig.timeBlocks.length > 1 && (
                            <button
                              onClick={() => removeBlock(day, idx)}
                              className="p-1 text-muted-foreground transition-colors hover:text-destructive"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={() => addBlock(day)}
                        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        Add time block
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : null}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button
          onClick={() => {
            void save();
          }}
          disabled={saving || loading}
        >
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
