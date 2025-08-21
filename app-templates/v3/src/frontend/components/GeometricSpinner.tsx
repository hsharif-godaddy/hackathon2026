import { cn } from '../lib/utils';

interface GeometricSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export default function GeometricSpinner({ size = 'md', className }: GeometricSpinnerProps) {
  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-12 h-12',
    lg: 'w-16 h-16',
  };

  return (
    <div className={cn('relative', sizeClasses[size], className)}>
      {/* Outer rotating circle */}
      <div className="absolute inset-0 border-2 border-primary/30 rounded-full animate-spin" 
           style={{ borderTopColor: 'hsl(var(--primary))' }} />
      
      {/* Inner floating squares */}
      <div className="absolute inset-2 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-0.5">
          <div className="w-1.5 h-1.5 bg-primary/80 rounded-sm animate-pulse" 
               style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 bg-primary/60 rounded-sm animate-pulse" 
               style={{ animationDelay: '200ms' }} />
          <div className="w-1.5 h-1.5 bg-primary/60 rounded-sm animate-pulse" 
               style={{ animationDelay: '400ms' }} />
          <div className="w-1.5 h-1.5 bg-primary/80 rounded-sm animate-pulse" 
               style={{ animationDelay: '600ms' }} />
        </div>
      </div>
      
      {/* Center dot */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-1 h-1 bg-primary rounded-full animate-ping" />
      </div>
    </div>
  );
}
