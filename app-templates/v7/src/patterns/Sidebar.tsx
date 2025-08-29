import { cn } from "@/lib/utils";

export interface SidebarProps {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  sidebarPosition?: "left" | "right";
  sidebarWidth?: "sm" | "md" | "lg";
  className?: string;
}

const sidebarWidthClasses = {
  sm: "w-64",
  md: "w-80", 
  lg: "w-96",
};

export function Sidebar({ 
  children, 
  sidebar,
  sidebarPosition = "left",
  sidebarWidth = "md",
  className 
}: SidebarProps) {
  if (!sidebar) {
    return (
      <div className={cn("container mx-auto px-4", className)}>
        {children}
      </div>
    );
  }

  return (
    <div className={cn("container mx-auto px-4", className)}>
      <div className="flex gap-8">
        {sidebarPosition === "left" && sidebar && (
          <aside className={cn(
            "hidden lg:block flex-shrink-0",
            sidebarWidthClasses[sidebarWidth]
          )}>
            {sidebar}
          </aside>
        )}

        <main className="flex-1 min-w-0">
          {children}
        </main>

        {sidebarPosition === "right" && sidebar && (
          <aside className={cn(
            "hidden lg:block flex-shrink-0",
            sidebarWidthClasses[sidebarWidth]
          )}>
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  );
}
