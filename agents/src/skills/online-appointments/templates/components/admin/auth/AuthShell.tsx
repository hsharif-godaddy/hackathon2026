import type { ElementType } from "react";
import { CalendarDays } from "lucide-react";
import { useAppConfig } from "@/contexts/AppConfigContext";

interface Props {
  left: React.ReactNode;
  right: React.ReactNode;
  /** Override brand name. Defaults to AppConfig.brand.name. */
  brandName?: string;
  /** Override brand icon. Defaults to AppConfig.brand.icon or CalendarDays. */
  brandIcon?: ElementType;
}

export default function AuthShell({ left, right, brandName, brandIcon }: Props) {
  const { brand } = useAppConfig();

  const name = brandName ?? brand.name;
  const Icon: ElementType = brandIcon ?? brand.icon ?? CalendarDays;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left panel */}
      <div className="hidden flex-col justify-between bg-foreground p-12 text-background lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background/10">
            <Icon className="h-4 w-4 text-background" />
          </div>
          <span className="font-semibold tracking-tight">{name}</span>
        </div>

        <div className="space-y-6">{left}</div>

        <p className="text-xs text-background/40">Secured with scrypt · Session-bound tokens</p>
      </div>

      {/* Right panel */}
      <div className="flex flex-col items-center justify-center bg-background px-6 py-12 sm:px-12">
        {/* Mobile logo */}
        <div className="mb-10 flex items-center gap-2.5 lg:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground">
            <Icon className="h-4 w-4 text-background" />
          </div>
          <span className="font-semibold tracking-tight text-foreground">{name}</span>
        </div>

        <div className="w-full max-w-sm">{right}</div>
      </div>
    </div>
  );
}
