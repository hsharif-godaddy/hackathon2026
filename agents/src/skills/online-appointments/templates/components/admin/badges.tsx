import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  CalendarDays,
  Repeat,
  User,
  Briefcase,
  Wrench,
  Scissors,
  Heart,
  Star,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ── Booking status ─────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof CheckCircle2; variant: "outline"; className: string }
> = {
  paid: {
    label: "Paid",
    icon: CheckCircle2,
    variant: "outline",
    className:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400",
  },
  unpaid: {
    label: "Unpaid",
    icon: AlertCircle,
    variant: "outline",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    variant: "outline",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    variant: "outline",
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status.toLowerCase()];
  if (!cfg) {
    return (
      <Badge variant="outline" className="text-xs capitalize">
        {status}
      </Badge>
    );
  }
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs font-medium", cfg.className)}>
      <Icon data-icon="inline-start" className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ── Service type ───────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; icon: typeof User; className: string }> = {
  business_hours: {
    label: "Appointment",
    icon: User,
    className:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400",
  },
  one_time: {
    label: "One-time",
    icon: CalendarDays,
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-400",
  },
  recurring_event: {
    label: "Recurring",
    icon: Repeat,
    className:
      "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-400",
  },
};

export function ServiceTypeBadge({ recurrenceType }: { recurrenceType: string | null }) {
  const cfg = TYPE_CONFIG[recurrenceType ?? "business_hours"] ??
    TYPE_CONFIG["business_hours"] ?? {
      label: "Appointment",
      icon: User,
      className:
        "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400",
    };
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs font-medium", cfg.className)}>
      <Icon data-icon="inline-start" className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ── Staff role ─────────────────────────────────────────────────────────────

const ROLE_ICONS: Record<string, typeof Briefcase> = {
  therapist: Heart,
  stylist: Scissors,
  trainer: Star,
  consultant: Briefcase,
  technician: Wrench,
  generic: User,
};

export function StaffRoleBadge({ role }: { role: string }) {
  const Icon = ROLE_ICONS[role.toLowerCase()] ?? Briefcase;
  return (
    <Badge variant="secondary" className="gap-1 text-xs font-medium">
      <Icon data-icon="inline-start" className="h-3 w-3" />
      {role}
    </Badge>
  );
}
