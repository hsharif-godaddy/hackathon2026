import { cn } from "@/lib/utils";

type Columns = 1 | 2 | 3 | 4 | 5 | 6;
type Gap = "xs" | "sm" | "md" | "lg" | "xl";

interface GridProps {
  children: React.ReactNode;
  cols?: Columns;
  gap?: Gap;
  responsive?: boolean;
  className?: string;
}

const columnClasses: Record<Columns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3", 
  4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
};

const nonResponsiveColumnClasses: Record<Columns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4", 
  5: "grid-cols-5",
  6: "grid-cols-6",
};

const gapClasses: Record<Gap, string> = {
  xs: "gap-2",
  sm: "gap-3",
  md: "gap-4", 
  lg: "gap-6",
  xl: "gap-8",
};

export function Grid({ 
  children, 
  cols = 3, 
  gap = "md",
  responsive = true,
  className 
}: GridProps) {
  const colClasses = responsive ? columnClasses[cols] : nonResponsiveColumnClasses[cols];

  // Handle missing children
  if (!children) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        No content provided for grid
      </div>
    );
  }

  return (
    <div 
      className={cn(
        "grid",
        colClasses,
        gapClasses[gap],
        className
      )}
    >
      {children}
    </div>
  );
}
