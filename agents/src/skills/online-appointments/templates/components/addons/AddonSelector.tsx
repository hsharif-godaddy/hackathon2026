import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Addon } from "@/lib/api-client";
import { formatCost, formatDuration } from "../booking/service-utils";

interface AddonSelectorProps {
  addons: Addon[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function AddonSelector({ addons, selectedIds, onChange }: AddonSelectorProps) {
  function toggle(id: string) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Add extras</p>
        <p className="text-xs text-muted-foreground">
          Optional — select any you'd like to include.
        </p>
      </div>

      <div className="space-y-2">
        {addons.map((addon) => {
          const selected = selectedIds.includes(addon.id);
          const dur = formatDuration(addon.duration);
          return (
            <button
              key={addon.id}
              type="button"
              onClick={() => toggle(addon.id)}
              aria-pressed={selected}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-all",
                selected
                  ? "border-primary bg-accent/40"
                  : "border-border bg-card hover:border-primary/50 hover:bg-accent/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                )}
              >
                {selected && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{addon.title}</span>
                  <span className="shrink-0 text-sm font-medium text-foreground">
                    {formatCost(addon.price)}
                  </span>
                </span>
                {addon.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {addon.description}
                  </span>
                )}
                {dur && (
                  <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={11} /> +{dur}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
