import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

/**
 * Available layout variants for the FeatureSpotlight component
 * - split: Side-by-side content and visual (default)
 * - overlay: Content overlaid on visual background
 * - floating: Glassmorphism effect with floating animations
 * - stepped: Sequential feature display with alternating layout
 */
type SpotlightVariant = "split" | "overlay" | "floating" | "stepped";

/**
 * Visual effects for the spotlight component
 * - glow: Subtle shadow with primary color (default)
 * - gradient: Background gradient overlay
 * - blur: Backdrop blur with transparency
 * - neon: Cyan glow effect with border
 */
type SpotlightEffect = "glow" | "gradient" | "blur" | "neon";

/**
 * Content alignment options
 * - left: Left-aligned content (default)
 * - right: Right-aligned content
 * - center: Center-aligned content
 * - bottom: Bottom-aligned content
 */
type ContentPosition = "left" | "right" | "center" | "bottom";

/**
 * Individual feature data structure for the spotlight
 */
export interface SpotlightFeature {
  /** Unique identifier for the feature */
  id: string;
  /** Feature title (required) */
  title: string;
  /** Feature description (required) */
  description: string;
  /** Visual element - can be any React component/JSX (required) */
  visual: React.ReactNode;
  /** Optional badge text to display */
  badge?: string;
  /** Optional stats array - displays automatically if provided */
  stats?: Array<{ label: string; value: string; }>;
  /** Optional call-to-action buttons or elements */
  cta?: React.ReactNode;
}

/**
 * Props for the FeatureSpotlight component
 * 
 * @example
 * ```tsx
 * <FeatureSpotlight 
 *   features={featuresArray}
 *   variant="split"
 *   effect="glow"
 *   showIndicators={true}
 *   autoRotate={true}
 * />
 * ```
 */
export interface FeatureSpotlightProps {
  /** Array of features to display (required) */
  features: SpotlightFeature[];
  /** Layout variant - defaults to "split" */
  variant?: SpotlightVariant;
  /** Visual effect - defaults to "glow" */
  effect?: SpotlightEffect;
  /** Content alignment - defaults to "left" */
  contentPosition?: ContentPosition;
  /** Auto-rotate through features every 5 seconds - defaults to false */
  autoRotate?: boolean;
  /** Show clickable indicators for navigation - defaults to false */
  showIndicators?: boolean;
  /** Additional CSS classes */
  className?: string;
}

const effectClasses: Record<SpotlightEffect, string> = {
  glow: "shadow-2xl shadow-primary/20",
  gradient: "bg-gradient-to-br from-primary/10 via-transparent to-secondary/10",
  blur: "backdrop-blur-sm bg-white/10 dark:bg-black/10",
  neon: "shadow-lg shadow-cyan-500/25 border border-cyan-500/30",
};

const contentPositionClasses: Record<ContentPosition, string> = {
  left: "text-left items-start",
  right: "text-right items-end", 
  center: "text-center items-center",
  bottom: "text-center items-end",
};

/**
 * FeatureSpotlight - A sophisticated component for highlighting product features
 * 
 * USAGE EXAMPLES:
 * 
 * Basic Usage:
 * ```tsx
 * <FeatureSpotlight features={featuresArray} />
 * ```
 * 
 * With Auto-rotation:
 * ```tsx
 * <FeatureSpotlight 
 *   features={featuresArray}
 *   variant="split"
 *   autoRotate={true}
 *   showIndicators={true}
 * />
 * ```
 * 
 * Sequential Display:
 * ```tsx
 * <FeatureSpotlight 
 *   features={featuresArray}
 *   variant="stepped"
 *   effect="glow"
 * />
 * ```
 * 
 * VALID VARIANTS: "split" | "overlay" | "floating" | "stepped"
 * VALID EFFECTS: "glow" | "gradient" | "blur" | "neon"
 */
export function FeatureSpotlight({ 
  features, 
  variant = "split",
  effect = "glow",
  contentPosition = "left",
  autoRotate = false,
  showIndicators = false,
  className 
}: FeatureSpotlightProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentFeature = features[currentIndex] || features[0];

  // Auto-rotate functionality
  useEffect(() => {
    if (!autoRotate || features.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % features.length);
    }, 5000); // Rotate every 5 seconds

    return () => clearInterval(interval);
  }, [autoRotate, features.length]);

  // Handle empty features array
  if (!features || features.length === 0) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        No features to display
      </div>
    );
  }

  if (variant === "split") {
    return (
      <div className={cn("grid lg:grid-cols-2 gap-12 items-center", className)}>
        {/* Content side */}
        <div className={cn("space-y-6", contentPositionClasses[contentPosition])}>
          {currentFeature.badge && (
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              {currentFeature.badge}
            </div>
          )}

          <div className="space-y-4">
            <h2 className="text-3xl lg:text-4xl font-bold tracking-tight">
              {currentFeature.title}
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl">
              {currentFeature.description}
            </p>
          </div>

          {currentFeature.stats && (
            <div className="grid grid-cols-2 gap-6">
              {currentFeature.stats.map((stat, index) => (
                <div key={index} className="space-y-1">
                  <div className="text-2xl font-bold text-primary">
                    {stat.value}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          {currentFeature.cta && (
            <div className="pt-4">
              {currentFeature.cta}
            </div>
          )}

          {/* Indicators for multiple features */}
          {showIndicators && features.length > 1 && (
            <div className="flex gap-2 pt-6">
              {features.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentIndex(index)}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    index === currentIndex 
                      ? "bg-primary" 
                      : "bg-primary/30 hover:bg-primary/50"
                  )}
                  aria-label={`Go to feature ${index + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Visual side */}
        <div className={cn(
          "relative rounded-2xl p-8",
          effectClasses[effect]
        )}>
          {/* Background decoration */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-secondary/5 rounded-2xl" />
          <div className="absolute top-4 right-4 w-32 h-32 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-4 left-4 w-24 h-24 bg-secondary/10 rounded-full blur-2xl" />

          <div className="relative z-10">
            {currentFeature.visual}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "overlay") {
    return (
      <div className={cn("relative overflow-hidden rounded-3xl", className)}>
        {/* Background visual */}
        <div className="absolute inset-0">
          {currentFeature.visual}
        </div>

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        {/* Content overlay */}
        <div className="relative z-10 p-8 lg:p-12 min-h-[500px] flex flex-col justify-end">
          {currentFeature.badge && (
            <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-white/20 text-white border border-white/30 mb-4 w-fit">
              {currentFeature.badge}
            </div>
          )}

          <div className="space-y-4 text-white max-w-2xl">
            <h2 className="text-3xl lg:text-5xl font-bold">
              {currentFeature.title}
            </h2>
            <p className="text-lg text-white/80">
              {currentFeature.description}
            </p>
          </div>

          {currentFeature.cta && (
            <div className="pt-6">
              {currentFeature.cta}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (variant === "floating") {
    return (
      <div className={cn("relative", className)}>
        {/* Background canvas */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 rounded-3xl" />

        {/* Floating elements */}
        <div className="absolute top-20 left-20 w-40 h-40 bg-gradient-to-br from-blue-400/20 to-purple-400/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-20 w-32 h-32 bg-gradient-to-br from-pink-400/20 to-orange-400/20 rounded-full blur-2xl animate-pulse delay-1000" />
        <div className="absolute top-1/2 left-1/3 w-24 h-24 bg-gradient-to-br from-green-400/20 to-blue-400/20 rounded-full blur-xl animate-pulse delay-500" />

        {/* Content container */}
        <div className="relative z-10 p-8 lg:p-16">
          <div className={cn(
            "bg-white/80 dark:bg-black/40 backdrop-blur-xl rounded-2xl p-8 lg:p-12 border border-white/20",
            effectClasses[effect]
          )}>
            {currentFeature.badge && (
              <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 mb-6">
                {currentFeature.badge}
              </div>
            )}

            <div className="space-y-6 text-center">
              <h2 className="text-3xl lg:text-4xl font-bold">
                {currentFeature.title}
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                {currentFeature.description}
              </p>
            </div>

            {/* Visual element */}
            <div className="mt-8 flex justify-center">
              {currentFeature.visual}
            </div>

            {currentFeature.cta && (
              <div className="mt-8 flex justify-center">
                {currentFeature.cta}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === "stepped") {
    return (
      <div className={cn("space-y-12", className)}>
        {features.map((feature, index) => (
          <div
            key={feature.id}
            className={cn(
              "grid lg:grid-cols-2 gap-8 items-center",
              index % 2 === 1 && "lg:grid-flow-col-dense"
            )}
          >
            {/* Visual */}
            <div className={cn(
              "relative rounded-2xl p-6",
              effectClasses[effect],
              index % 2 === 1 && "lg:col-start-2"
            )}>
              {/* Step indicator */}
              <div className="absolute -top-4 -left-4 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-bold">
                {index + 1}
              </div>

              {feature.visual}
            </div>

            {/* Content */}
            <div className={cn(
              "space-y-4",
              index % 2 === 1 && "lg:col-start-1 lg:row-start-1"
            )}>
              {feature.badge && (
                <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  {feature.badge}
                </div>
              )}

              <h3 className="text-2xl font-bold">{feature.title}</h3>
              <p className="text-muted-foreground">{feature.description}</p>

              {feature.cta && (
                <div className="pt-2">
                  {feature.cta}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
