import { cn } from "@/lib/utils";

export type BentoVariant = "default" | "feature" | "gallery" | "dashboard";
export type BentoSize = "sm" | "md" | "lg";
export type SpanType = "1x1" | "1x2" | "2x1" | "2x2" | "2x3" | "3x2";

export interface BentoItem {
  id: string;
  content: React.ReactNode;
  span?: SpanType;
  featured?: boolean;
  className?: string;
}

export interface BentoGridProps {
  items: BentoItem[];
  variant?: BentoVariant;
  size?: BentoSize;
  gap?: "sm" | "md" | "lg";
  className?: string;
}

const spanClasses = {
  "1x1": "col-span-1 row-span-1",
  "1x2": "col-span-1 row-span-2",
  "2x1": "col-span-2 row-span-1", 
  "2x2": "col-span-2 row-span-2",
  "2x3": "col-span-2 row-span-3",
  "3x2": "col-span-3 row-span-2",
};

const variantClasses: Record<BentoVariant, string> = {
  default: "grid-cols-1 md:grid-cols-3 lg:grid-cols-4 auto-rows-[200px]",
  feature: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 auto-rows-[240px]",
  gallery: "grid-cols-2 md:grid-cols-4 lg:grid-cols-6 auto-rows-[160px]",
  dashboard: "grid-cols-1 md:grid-cols-3 lg:grid-cols-4 auto-rows-[180px]",
};

const sizeClasses: Record<BentoSize, string> = {
  sm: "auto-rows-[140px]",
  md: "auto-rows-[200px]", 
  lg: "auto-rows-[260px]",
};

const gapClasses = {
  sm: "gap-3",
  md: "gap-4",
  lg: "gap-6",
};

export function BentoGrid({ 
  items, 
  variant = "default",
  size = "md",
  gap = "md",
  className 
}: BentoGridProps) {
  // Handle empty or undefined items
  if (!items || items.length === 0) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        No items to display
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "grid w-full",
        variantClasses[variant],
        sizeClasses[size],
        gapClasses[gap],
        className
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-card transition-all duration-300 hover:shadow-lg",
            spanClasses[item.span || "1x1"],
            item.featured && [
              "ring-2 ring-primary/20 shadow-lg",
              "before:absolute before:inset-0 before:bg-gradient-to-br before:from-primary/5 before:to-transparent before:pointer-events-none"
            ],
            item.className
          )}
        >
          {/* Featured badge */}
          {item.featured && (
            <div className="absolute top-3 right-3 z-10">
              <div className="inline-flex items-center rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                Featured
              </div>
            </div>
          )}

          {/* Hover effect overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          {/* Content */}
          <div className="relative h-full p-4 flex flex-col">
            {item.content}
          </div>

          {/* Interactive border glow */}
          <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-blue-500/0 via-purple-500/0 to-pink-500/0 group-hover:from-blue-500/10 group-hover:via-purple-500/10 group-hover:to-pink-500/10 transition-all duration-500" />
        </div>
      ))}
    </div>
  );
}

// Helper component for common bento item patterns
export function BentoCard({ 
  title, 
  description, 
  icon,
  action,
  className 
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col justify-between h-full", className)}>
      <div className="space-y-2">
        {icon && (
          <div className="w-8 h-8 text-primary">
            {icon}
          </div>
        )}
        <h3 className="font-semibold text-lg leading-tight">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-3">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="mt-4">
          {action}
        </div>
      )}
    </div>
  );
}
