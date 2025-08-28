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

  const borderWidths = {
    sm: 'border-[1px]',
    md: 'border-2',
    lg: 'border-3',
    xl: 'border-4',
    hero: 'border-[6px]',
  };

  const orbitDotSizes = {
    sm: 'w-1 h-1',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2',
    xl: 'w-3 h-3',
    hero: 'w-4 h-4',
  };

  const centerSizes = {
    sm: { outer: 'inset-2', inner: 'inset-3', core: 'w-1 h-1' },
    md: { outer: 'inset-3', inner: 'inset-4', core: 'w-1.5 h-1.5' },
    lg: { outer: 'inset-5', inner: 'inset-6', core: 'w-2 h-2' },
    xl: { outer: 'inset-8', inner: 'inset-10', core: 'w-3 h-3' },
    hero: { outer: 'inset-12', inner: 'inset-16', core: 'w-4 h-4' },
  };

  const shapeSizes = {
    sm: { triangle: 2, square: 'w-1 h-1', circle: 'w-1 h-1', diamond: 'w-1 h-1' },
    md: { triangle: 3, square: 'w-1.5 h-1.5', circle: 'w-1.5 h-1.5', diamond: 'w-1.5 h-1.5' },
    lg: { triangle: 4, square: 'w-2 h-2', circle: 'w-2 h-2', diamond: 'w-2 h-2' },
    xl: { triangle: 6, square: 'w-3 h-3', circle: 'w-3 h-3', diamond: 'w-3 h-3' },
    hero: { triangle: 8, square: 'w-4 h-4', circle: 'w-4 h-4', diamond: 'w-4 h-4' },
  };

  return (
    <div className={cn('relative', sizeClasses[size], className)}>
      {/* Outer rotating ring - clean border style like v1 */}
      <div 
        className={cn(
          'absolute inset-0 rounded-full animate-rotate-clockwise border-blue-400',
          borderWidths[size]
        )}
      />
      
      {/* Middle counter-rotating ring */}
      <div 
        className={cn(
          'absolute rounded-full animate-rotate-counter border-purple-400',
          centerSizes[size].outer,
          borderWidths[size]
        )}
      />
      
      {/* Inner pulsing circle with gradient */}
      <div 
        className={cn(
          'absolute rounded-full animate-pulse-slow',
          centerSizes[size].inner
        )}
        style={{
          background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(262 83% 58%))'
        }}
      />
      
      {/* Central floating element with white background */}
      <div 
        className={cn(
          'absolute bg-white rounded-full shadow-lg animate-float flex items-center justify-center',
          centerSizes[size].inner
        )}
      >
        <div 
          className={cn(
            'rounded-full',
            centerSizes[size].core
          )}
          style={{
            background: 'linear-gradient(135deg, hsl(221 83% 53%), hsl(262 83% 58%))'
          }}
        />
      </div>
      
      {/* Orbiting dots at cardinal points - clean positioning like v1 */}
      <div className={cn('absolute inset-0 animate-rotate-clockwise', sizeClasses[size])}>
        {/* Top */}
        <div 
          className={cn(
            'absolute bg-blue-500 rounded-full',
            orbitDotSizes[size]
          )}
          style={{
            top: '-2px',
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        />
        {/* Right */}
        <div 
          className={cn(
            'absolute bg-purple-500 rounded-full',
            orbitDotSizes[size]
          )}
          style={{
            top: '50%',
            right: '-2px',
            transform: 'translateY(-50%)'
          }}
        />
        {/* Bottom */}
        <div 
          className={cn(
            'absolute bg-indigo-500 rounded-full',
            orbitDotSizes[size]
          )}
          style={{
            bottom: '-2px',
            left: '50%',
            transform: 'translateX(-50%)'
          }}
        />
        {/* Left */}
        <div 
          className={cn(
            'absolute bg-violet-500 rounded-full',
            orbitDotSizes[size]
          )}
          style={{
            top: '50%',
            left: '-2px',
            transform: 'translateY(-50%)'
          }}
        />
      </div>
      
      {/* Geometric shapes around perimeter - positioned like v1 */}
      <div className="absolute inset-0">
        {/* Top-left square */}
        <div 
          className="absolute animate-bounce-gentle"
          style={{
            top: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
            left: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
          }}
        >
          <div 
            className={cn(
              'bg-blue-400 transform rotate-45',
              shapeSizes[size].square
            )}
          />
        </div>
        
        {/* Top-right triangle */}
        <div 
          className="absolute animate-float"
          style={{
            top: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
            right: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
          }}
        >
          <div 
            style={{
              width: 0,
              height: 0,
              borderLeft: `${shapeSizes[size].triangle}px solid transparent`,
              borderRight: `${shapeSizes[size].triangle}px solid transparent`,
              borderBottom: `${shapeSizes[size].triangle * 1.5}px solid hsl(262 83% 58%)`,
            }}
          />
        </div>
        
        {/* Bottom-left circle */}
        <div 
          className="absolute animate-pulse-slow"
          style={{
            bottom: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
            left: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
          }}
        >
          <div 
            className={cn(
              'bg-indigo-400 rounded-full',
              shapeSizes[size].circle
            )}
          />
        </div>
        
        {/* Bottom-right diamond */}
        <div 
          className="absolute animate-spin-slow"
          style={{
            bottom: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
            right: size === 'sm' ? '-6px' : size === 'md' ? '-8px' : size === 'lg' ? '-12px' : size === 'xl' ? '-16px' : '-24px',
          }}
        >
          <div 
            className={cn(
              'bg-violet-400 transform rotate-45',
              shapeSizes[size].diamond
            )}
          />
        </div>
      </div>
    </div>
  );
}