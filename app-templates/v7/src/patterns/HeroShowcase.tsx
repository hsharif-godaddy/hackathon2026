import { cn } from "@/lib/utils";

type HeroVariant = "gradient" | "image" | "split" | "floating";
type HeroSize = "sm" | "md" | "lg" | "xl" | "full";
type ContentAlignment = "left" | "center" | "right";

export interface HeroShowcaseProps {
  children: React.ReactNode;
  variant?: HeroVariant;
  size?: HeroSize;
  contentAlignment?: ContentAlignment;
  backgroundImage?: string;
  overlay?: boolean;
  overlayOpacity?: "light" | "medium" | "dark";
  gradientFrom?: string;
  gradientTo?: string;
  className?: string;
}

const variantClasses: Record<HeroVariant, string> = {
  gradient: "bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600",
  image: "bg-cover bg-center bg-no-repeat",
  split: "bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900",
  floating: "bg-gradient-to-br from-indigo-50 via-white to-cyan-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900",
};

const sizeClasses: Record<HeroSize, string> = {
  sm: "min-h-[40vh] py-12",
  md: "min-h-[50vh] py-16", 
  lg: "min-h-[70vh] py-20",
  xl: "min-h-[80vh] py-24",
  full: "min-h-screen py-32",
};

const alignmentClasses: Record<ContentAlignment, string> = {
  left: "text-left justify-start",
  center: "text-center justify-center",
  right: "text-right justify-end",
};

const overlayClasses = {
  light: "bg-black/20",
  medium: "bg-black/40", 
  dark: "bg-black/60",
};

export function HeroShowcase({ 
  children, 
  variant = "gradient",
  size = "lg",
  contentAlignment = "center",
  backgroundImage,
  overlay = false,
  overlayOpacity = "medium",
  gradientFrom,
  gradientTo,
  className 
}: HeroShowcaseProps) {
  // Handle missing children
  if (!children) {
    return (
      <section className={cn("relative overflow-hidden", sizeClasses[size], className)}>
        <div className="container relative z-20 mx-auto px-4 h-full">
          <div className="flex flex-col h-full justify-center items-center text-center">
            <div className="text-muted-foreground">
              No content provided for hero section
            </div>
          </div>
        </div>
      </section>
    );
  }
  const customGradient = gradientFrom && gradientTo 
    ? `bg-gradient-to-br from-${gradientFrom} to-${gradientTo}`
    : "";

  const backgroundStyle = backgroundImage 
    ? { backgroundImage: `url(${backgroundImage})` }
    : {};

  return (
    <section 
      className={cn(
        "relative overflow-hidden",
        sizeClasses[size],
        variant === "image" ? variantClasses.image : customGradient || variantClasses[variant],
        className
      )}
      style={backgroundStyle}
    >
      {/* Overlay */}
      {overlay && (
        <div className={cn("absolute inset-0 z-10", overlayClasses[overlayOpacity])} />
      )}

      {/* Floating elements for 'floating' variant */}
      {variant === "floating" && (
        <>
          <div className="absolute top-20 right-20 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 left-20 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
          <div className="absolute top-40 left-1/3 w-24 h-24 bg-pink-500/10 rounded-full blur-2xl animate-pulse delay-500" />
        </>
      )}

      {/* Content container */}
      <div className="container relative z-20 mx-auto px-4 h-full">
        <div className={cn(
          "flex flex-col h-full",
          alignmentClasses[contentAlignment]
        )}>
          {/* Split variant special layout */}
          {variant === "split" ? (
            <div className="grid lg:grid-cols-2 gap-12 items-center h-full">
              <div className="space-y-6">
                {children}
              </div>
              <div className="hidden lg:flex justify-center">
                <div className="w-96 h-96 bg-gradient-to-br from-blue-400/20 to-purple-400/20 rounded-full blur-3xl" />
              </div>
            </div>
          ) : (
            <div className="space-y-8 max-w-4xl mx-auto">
              {children}
            </div>
          )}
        </div>
      </div>

      {/* Bottom gradient fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background/80 to-transparent" />
    </section>
  );
}
