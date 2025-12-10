/**
 * BlogHero Component Props
 */
interface BlogHeroProps {
  /** Hero title */
  title?: string;
  /** Hero subtitle/description */
  subtitle?: string;
  /** Hero variant */
  variant?: 'default' | 'minimal' | 'centered';
  /** Background image URL (optional) */
  backgroundImage?: string;
}

/**
 * BlogHero Component
 *
 * Displays a hero section for blog pages with title, subtitle, and optional background.
 * Automatically inherits site colors from CSS variables.
 *
 * @param props - Component props
 * @returns BlogHero component
 */
export default function BlogHero({
  title = 'Blog',
  subtitle = 'Thoughts, stories, and ideas',
  variant = 'default',
  backgroundImage
}: BlogHeroProps) {
  if (variant === 'minimal') {
    return (
      <div className="border-b border-border bg-background">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-muted-foreground mt-2">{subtitle}</p>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'centered') {
    return (
      <div className="relative bg-background border-b border-border">
        {backgroundImage && (
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
        )}
        <div className="relative max-w-4xl mx-auto px-4 py-24 text-center">
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div className="relative bg-gradient-to-br from-primary/5 to-accent/5 border-b border-border overflow-hidden">
      {backgroundImage && (
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: `url(${backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        />
      )}
      <div className="relative max-w-7xl mx-auto px-4 py-20 md:py-28">
        <div className="max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6 leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xl md:text-2xl text-muted-foreground leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Decorative elements */}
      <div className="absolute top-0 right-0 -mt-12 -mr-12 w-64 h-64 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
    </div>
  );
}
