import { cn } from "@/lib/utils";

type SectionSize = "sm" | "md" | "lg" | "xl";

export interface SectionProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  size?: SectionSize;
  centerText?: boolean;
  className?: string;
}

const sizeClasses: Record<SectionSize, string> = {
  sm: "py-8",
  md: "py-12",
  lg: "py-16",
  xl: "py-24",
};

export function Section({ 
  children, 
  title,
  description,
  size = "lg",
  centerText = false,
  className 
}: SectionProps) {
  // Handle missing children
  if (!children) {
    return (
      <section className={cn(sizeClasses[size], className)}>
        <div className="container mx-auto px-4">
          {(title || description) && (
            <div className={cn("mb-8", centerText && "text-center")}>
              {title && (
                <h2 className="text-3xl font-bold tracking-tight mb-2">
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-muted-foreground text-lg max-w-2xl">
                  {description}
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }
  return (
    <section 
      className={cn(
        sizeClasses[size],
        className
      )}
    >
      <div className="container mx-auto px-4">
        {(title || description) && (
          <div className={cn(
            "mb-8",
            centerText && "text-center"
          )}>
            {title && (
              <h2 className="text-3xl font-bold tracking-tight mb-2">
                {title}
              </h2>
            )}
            {description && (
              <p className="text-muted-foreground text-lg max-w-2xl">
                {description}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
