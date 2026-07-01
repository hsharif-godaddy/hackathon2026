import { User } from "lucide-react";
import { WidgetFrame } from "./widget-frame";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StaffMember } from "./use-dashboard-data";

interface ActiveStaffWidgetProps {
  data: StaffMember[] | null;
  loading?: boolean;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ActiveStaffWidget({ data, loading = false }: ActiveStaffWidgetProps) {
  if (!loading && !data) return null;

  return (
    <WidgetFrame
      title="Active Staff"
      description={data ? `${data.length} member${data.length !== 1 ? "s" : ""} on your team` : ""}
      loading={loading}
      headerAction={
        data && (
          <Badge variant="secondary" className="tabular-nums">
            {data.length}
          </Badge>
        )
      }
    >
      <ScrollArea className="h-[200px]">
        <div className="space-y-2 pt-1">
          {(data ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-accent/50"
            >
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {initials(s.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.name ?? <span className="italic text-muted-foreground">Unnamed</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {s.contact?.email ?? s.role}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs">
                {s.role}
              </Badge>
            </div>
          ))}
          {(data ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <User className="mb-2 h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No active staff members</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </WidgetFrame>
  );
}
