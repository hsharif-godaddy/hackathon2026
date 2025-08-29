import { cn } from "@/lib/utils";

type TimelineVariant = "vertical" | "horizontal" | "zigzag" | "centered";
type TimelineStyle = "line" | "dots" | "cards" | "minimal";

export interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  timestamp?: string;
  content?: React.ReactNode;
  icon?: React.ReactNode;
  status?: "completed" | "current" | "upcoming";
  accent?: "primary" | "success" | "warning" | "info";
}

export interface TimelineFlowProps {
  items: TimelineItem[];
  variant?: TimelineVariant;
  style?: TimelineStyle;
  showConnectors?: boolean;
  animated?: boolean;
  className?: string;
}

const statusClasses = {
  completed: "bg-green-500 text-white",
  current: "bg-primary text-primary-foreground ring-4 ring-primary/20",
  upcoming: "bg-muted text-muted-foreground",
};

const accentClasses = {
  primary: "border-primary text-primary",
  success: "border-green-500 text-green-600",
  warning: "border-yellow-500 text-yellow-600", 
  info: "border-blue-500 text-blue-600",
};

export function TimelineFlow({ 
  items, 
  variant = "vertical",
  style = "line",
  showConnectors = true,
  animated = true,
  className 
}: TimelineFlowProps) {
  // Handle empty or undefined items
  if (!items || items.length === 0) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        No timeline items to display
      </div>
    );
  }
  if (variant === "horizontal") {
    return (
      <div className={cn("w-full overflow-x-auto", className)}>
        <div className="flex min-w-max space-x-8 pb-4">
          {items.map((item, index) => (
            <div key={item.id} className="flex flex-col items-center min-w-[280px]">
              {/* Timeline node */}
              <div className="relative mb-4">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                  statusClasses[item.status || "upcoming"],
                  animated && "hover:scale-110"
                )}>
                  {item.icon || (
                    <span className="text-sm font-semibold">{index + 1}</span>
                  )}
                </div>

                {/* Connector line */}
                {showConnectors && index < items.length - 1 && (
                  <div className="absolute top-6 left-12 w-8 h-0.5 bg-border" />
                )}
              </div>

              {/* Content */}
              <div className="text-center space-y-2">
                {item.timestamp && (
                  <time className="text-xs text-muted-foreground font-medium">
                    {item.timestamp}
                  </time>
                )}
                <h3 className="font-semibold text-sm">{item.title}</h3>
                {item.description && (
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                )}
                {item.content}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === "zigzag") {
    return (
      <div className={cn("relative max-w-4xl mx-auto", className)}>
        {items.map((item, index) => {
          const isEven = index % 2 === 0;
          return (
            <div key={item.id} className="relative">
              {/* Connector line */}
              {showConnectors && index < items.length - 1 && (
                <div className="absolute left-1/2 top-16 w-0.5 h-16 bg-border transform -translate-x-px" />
              )}

              <div className={cn(
                "flex items-center mb-16",
                isEven ? "flex-row" : "flex-row-reverse"
              )}>
                {/* Content */}
                <div className={cn(
                  "w-5/12",
                  isEven ? "pr-8 text-right" : "pl-8 text-left"
                )}>
                  <div className={cn(
                    "p-6 rounded-lg border bg-card",
                    animated && "hover:shadow-lg transition-shadow duration-300"
                  )}>
                    {item.timestamp && (
                      <time className="text-sm text-muted-foreground font-medium">
                        {item.timestamp}
                      </time>
                    )}
                    <h3 className="font-semibold text-lg mb-2">{item.title}</h3>
                    {item.description && (
                      <p className="text-muted-foreground mb-3">{item.description}</p>
                    )}
                    {item.content}
                  </div>
                </div>

                {/* Timeline node */}
                <div className="relative z-10">
                  <div className={cn(
                    "w-4 h-4 rounded-full border-4 border-background",
                    statusClasses[item.status || "upcoming"],
                    animated && "hover:scale-125 transition-transform duration-300"
                  )}>
                    {item.icon && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        {item.icon}
                      </div>
                    )}
                  </div>
                </div>

                {/* Spacer */}
                <div className="w-5/12" />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Default vertical timeline
  return (
    <div className={cn("relative", className)}>
      {/* Main timeline line */}
      {showConnectors && (
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border" />
      )}

      <div className="space-y-8">
        {items.map((item, index) => (
          <div key={item.id} className="relative flex items-start space-x-4">
            {/* Timeline node */}
            <div className="relative z-10 flex-shrink-0">
              <div className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                statusClasses[item.status || "upcoming"],
                item.accent && accentClasses[item.accent],
                animated && "hover:scale-110"
              )}>
                {item.icon || (
                  <span className="text-sm font-semibold">{index + 1}</span>
                )}
              </div>
            </div>

            {/* Content */}
            <div className={cn(
              "flex-1 pb-8",
              style === "cards" && "bg-card border rounded-lg p-6",
              animated && style === "cards" && "hover:shadow-md transition-shadow duration-300"
            )}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-lg">{item.title}</h3>
                {item.timestamp && (
                  <time className="text-sm text-muted-foreground font-medium">
                    {item.timestamp}
                  </time>
                )}
              </div>

              {item.description && (
                <p className="text-muted-foreground mb-4">{item.description}</p>
              )}

              {item.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
