import { cn } from '../lib/utils';

interface GeometricSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'hero';
  className?: string;
}

export default function GeometricSpinner({ size = 'md', className }: GeometricSpinnerProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-20 h-20',
    xl: 'w-32 h-32',
    hero: 'w-48 h-48',
  };

  const dotSizes = {
    sm: 'w-1 h-1',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
    xl: 'w-3 h-3',
    hero: 'w-4 h-4',
  };

  const borderWidths = {
    sm: 'border-2',
    md: 'border-2',
    lg: 'border-3',
    xl: 'border-4',
    hero: 'border-[6px]',
  };

  return (
    <div className={cn('relative', sizeClasses[size], className)}>
      {/* Outer rotating ring with gradient */}
      <div 
        className={cn(
          'absolute inset-0 rounded-full animate-spin',
          borderWidths[size]
        )}
        style={{
          background: `conic-gradient(from 0deg, transparent, hsl(var(--primary) / 0.3), hsl(var(--primary)), transparent)`,
          borderRadius: '50%',
          animationDuration: '2s',
        }} 
      />
      
      {/* Middle counter-rotating ring */}
      <div 
        className={cn(
          'absolute inset-2 rounded-full',
          size === 'sm' ? 'border-[1px]' : 
          size === 'md' ? 'border-[1px]' :
          size === 'lg' ? 'border-2' :
          size === 'xl' ? 'border-3' :
          'border-4'
        )}
        style={{
          background: `conic-gradient(from 180deg, hsl(var(--primary) / 0.1), transparent, hsl(var(--primary) / 0.5), transparent)`,
          borderRadius: '50%',
          animation: 'spin 3s linear infinite reverse',
        }} 
      />
      
      {/* Inner orbiting elements */}
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: '4s' }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={cn(
              'absolute bg-primary rounded-full',
              dotSizes[size]
            )}
            style={{
              top: '10%',
              left: '50%',
              transformOrigin: '50% 400%',
              transform: `rotate(${i * 60}deg) translateY(-50%)`,
              opacity: 0.7 + (i % 2) * 0.3,
              animationDelay: `${i * 100}ms`,
            }}
          />
        ))}
      </div>
      
      {/* Floating geometric shapes */}
      <div className="absolute inset-0">
        {/* Triangle */}
        <div 
          className="absolute animate-bounce"
          style={{
            top: '20%',
            left: '20%',
            animationDuration: '2s',
            animationDelay: '0ms',
          }}
        >
          <div 
            className="border-primary/60"
            style={{
              width: 0,
              height: 0,
              borderLeft: size === 'hero' ? '8px solid transparent' : 
                         size === 'xl' ? '6px solid transparent' :
                         size === 'lg' ? '4px solid transparent' : '3px solid transparent',
              borderRight: size === 'hero' ? '8px solid transparent' : 
                          size === 'xl' ? '6px solid transparent' :
                          size === 'lg' ? '4px solid transparent' : '3px solid transparent',
              borderBottom: size === 'hero' ? '12px solid hsl(var(--primary) / 0.6)' : 
                           size === 'xl' ? '9px solid hsl(var(--primary) / 0.6)' :
                           size === 'lg' ? '6px solid hsl(var(--primary) / 0.6)' : '4px solid hsl(var(--primary) / 0.6)',
            }}
          />
        </div>
        
        {/* Square */}
        <div 
          className="absolute animate-bounce"
          style={{
            top: '70%',
            right: '20%',
            animationDuration: '2.5s',
            animationDelay: '500ms',
          }}
        >
          <div 
            className={cn(
              'bg-primary/50 rotate-45',
              size === 'hero' ? 'w-4 h-4' :
              size === 'xl' ? 'w-3 h-3' :
              size === 'lg' ? 'w-2 h-2' : 'w-1.5 h-1.5'
            )}
          />
        </div>
        
        {/* Diamond */}
        <div 
          className="absolute animate-bounce"
          style={{
            bottom: '20%',
            left: '70%',
            animationDuration: '3s',
            animationDelay: '1s',
          }}
        >
          <div 
            className={cn(
              'bg-primary/40 rotate-45',
              size === 'hero' ? 'w-3 h-3' :
              size === 'xl' ? 'w-2.5 h-2.5' :
              size === 'lg' ? 'w-2 h-2' : 'w-1 h-1'
            )}
            style={{ clipPath: 'polygon(50% 0%, 0% 50%, 50% 100%, 100% 50%)' }}
          />
        </div>
      </div>
      
      {/* Center pulsing core */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div 
          className={cn(
            'bg-primary rounded-full animate-ping',
            size === 'hero' ? 'w-6 h-6' :
            size === 'xl' ? 'w-4 h-4' :
            size === 'lg' ? 'w-3 h-3' :
            size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5'
          )}
          style={{ animationDuration: '1.5s' }}
        />
        <div 
          className={cn(
            'absolute bg-primary rounded-full',
            size === 'hero' ? 'w-3 h-3' :
            size === 'xl' ? 'w-2 h-2' :
            size === 'lg' ? 'w-1.5 h-1.5' :
            size === 'md' ? 'w-1 h-1' : 'w-0.5 h-0.5'
          )}
        />
      </div>
      
      {/* Outer floating particles */}
      <div className="absolute inset-0 animate-spin" style={{ animationDuration: '8s' }}>
        {[0, 1, 2].map((i) => (
          <div
            key={`particle-${i}`}
            className={cn(
              'absolute bg-primary/30 rounded-full animate-pulse',
              size === 'hero' ? 'w-2 h-2' :
              size === 'xl' ? 'w-1.5 h-1.5' :
              'w-1 h-1'
            )}
            style={{
              top: `${20 + i * 20}%`,
              left: '90%',
              transformOrigin: '-200% 50%',
              animationDelay: `${i * 300}ms`,
              animationDuration: '2s',
            }}
          />
        ))}
      </div>
    </div>
  );
}