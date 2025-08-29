import { cn } from "@/lib/utils";

type ShowcaseVariant = "hover" | "tabs" | "accordion" | "carousel";
type ShowcaseStyle = "modern" | "minimal" | "glass" | "neon";
type RevealDirection = "up" | "down" | "left" | "right" | "fade";

interface ShowcaseItem {
  id: string;
  title: string;
  description?: string;
  content: React.ReactNode;
  preview?: React.ReactNode;
  accent?: string;
  featured?: boolean;
}

export interface InteractiveShowcaseProps {
  items: ShowcaseItem[];
  variant?: ShowcaseVariant;
  style?: ShowcaseStyle;
  revealDirection?: RevealDirection;
  autoHeight?: boolean;
  showPreviews?: boolean;
  className?: string;
}

const styleClasses: Record<ShowcaseStyle, string> = {
  modern: "bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border",
  minimal: "bg-background border",
  glass: "bg-white/10 backdrop-blur-md border border-white/20",
  neon: "bg-slate-900 border border-cyan-500/30 shadow-lg shadow-cyan-500/10",
};

const revealClasses: Record<RevealDirection, string> = {
  up: "translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
  down: "translate-y-[-1rem] opacity-0 group-hover:translate-y-0 group-hover:opacity-100", 
  left: "translate-x-4 opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
  right: "translate-x-[-1rem] opacity-0 group-hover:translate-x-0 group-hover:opacity-100",
  fade: "opacity-0 group-hover:opacity-100",
};

export function InteractiveShowcase({ 
  items, 
  variant = "hover",
  style = "modern",
  revealDirection = "up",
  showPreviews = true,
  className 
}: InteractiveShowcaseProps) {
  // Handle empty or undefined items
  if (!items || items.length === 0) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        No showcase items to display
      </div>
    );
  }

  if (variant === "hover") {
    return (
      <div className={cn("grid gap-6", className)}>
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "group relative overflow-hidden rounded-xl p-6 transition-all duration-500 hover:scale-[1.02]",
              styleClasses[style],
              item.featured && "ring-2 ring-primary/20"
            )}
          >
            {/* Background accent */}
            {item.accent && (
              <div 
                className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500"
                style={{ background: `linear-gradient(135deg, ${item.accent}20, transparent)` }}
              />
            )}

            {/* Preview content */}
            {showPreviews && item.preview && (
              <div className="mb-4">
                {item.preview}
              </div>
            )}

            {/* Title and description */}
            <div className="relative z-10 mb-4">
              <h3 className="text-xl font-semibold mb-2 group-hover:text-primary transition-colors">
                {item.title}
              </h3>
              {item.description && (
                <p className="text-muted-foreground text-sm">
                  {item.description}
                </p>
              )}
            </div>

            {/* Revealed content */}
            <div className={cn(
              "transition-all duration-500 ease-out",
              revealClasses[revealDirection]
            )}>
              {item.content}
            </div>

            {/* Interactive overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "tabs") {
    return (
      <div className={cn("rounded-xl overflow-hidden", styleClasses[style], className)}>
        {/* Tab headers */}
        <div className="flex border-b bg-muted/30">
          {items.map((item, index) => (
            <button
              key={item.id}
              className={cn(
                "px-6 py-3 text-sm font-medium transition-colors hover:bg-muted/50",
                index === 0 && "bg-background border-b-2 border-primary"
              )}
            >
              {item.title}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="p-6">
          {items[0]?.content || (
            <div className="text-center text-muted-foreground py-8">
              No content available
            </div>
          )}
        </div>
      </div>
    );
  }

  if (variant === "accordion") {
    return (
      <div className={cn("space-y-2", className)}>
        {items.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              "group rounded-lg overflow-hidden",
              styleClasses[style]
            )}
          >
            <button className="w-full px-6 py-4 text-left font-medium hover:bg-muted/50 transition-colors flex items-center justify-between">
              <span>{item.title}</span>
              <span className="text-muted-foreground group-hover:rotate-180 transition-transform">
                ▼
              </span>
            </button>

            {index === 0 && (
              <div className="px-6 pb-4 border-t">
                {item.content || (
                  <div className="text-center text-muted-foreground py-4">
                    No content available
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (variant === "carousel") {
    return (
      <div className={cn(
        "relative rounded-xl overflow-hidden",
        styleClasses[style],
        className
      )}>
        <div className="flex overflow-x-auto snap-x snap-mandatory">
          {items.map((item) => (
            <div
              key={item.id}
              className="min-w-full snap-center p-8"
            >
              <div className="max-w-2xl mx-auto text-center">
                {item.preview && (
                  <div className="mb-6">
                    {item.preview}
                  </div>
                )}
                <h3 className="text-2xl font-bold mb-4">{item.title}</h3>
                {item.description && (
                  <p className="text-muted-foreground mb-6">{item.description}</p>
                )}
                {item.content}
              </div>
            </div>
          ))}
        </div>

        {/* Navigation dots */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex space-x-2">
          {items.map((_, index) => (
            <button
              key={index}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                index === 0 ? "bg-primary" : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
      </div>
    );
  }

  return null;
}
