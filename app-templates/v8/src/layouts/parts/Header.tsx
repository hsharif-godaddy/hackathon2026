import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';

export interface HeaderConfig {
  variant?: 'default' | 'centered' | 'split';
  logoPosition?: 'left' | 'center' | 'right';
  navPosition?: 'left' | 'center' | 'right';
  sticky?: boolean;
  transparent?: boolean;
  blur?: boolean;
  border?: boolean;
  mobileBehavior?: 'hamburger' | 'bottom-bar' | 'slide-down';
  logo?: {
    text?: string;
    href?: string;
    className?: string;
  };
  navItems?: Array<{
    href: string;
    label: string;
    external?: boolean;
  }>;
  actions?: React.ReactNode;
}

interface HeaderPatternProps {
  config?: HeaderConfig;
  className?: string;
}

export default function HeaderPattern({ config = {}, className }: HeaderPatternProps) {
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const {
    variant = 'default',
    logoPosition = 'left',
    navPosition = 'right',
    sticky = true,
    transparent = false,
    blur = true,
    border = true,
    mobileBehavior = 'hamburger',
    logo = { text: 'App', href: '/' },
    navItems = [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
    ],
    actions
  } = config;

  const renderLogo = () => (
    <Link
      to={logo.href || '/'}
      className={cn(
        "text-xl font-bold text-foreground",
        logo.className
      )}
    >
      {logo.text}
    </Link>
  );

  const renderNav = () => (
    <nav className={cn(
      "flex gap-4",
      mobileBehavior === 'hamburger' && "hidden md:flex"
    )}>
      {navItems.map((item) => (
        item.external || item.href.startsWith('#') ? (
          <a
            key={item.href}
            href={item.href}
            target={item.external ? "_blank" : undefined}
            rel={item.external ? "noopener noreferrer" : undefined}
            className={cn(
              "text-sm font-medium transition-colors hover:text-primary",
              location.pathname === item.href
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {item.label}
          </a>
        ) : (
          <Link
            key={item.href}
            to={item.href}
            className={cn(
              "text-sm font-medium transition-colors hover:text-primary",
              location.pathname === item.href
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {item.label}
          </Link>
        )
      ))}
    </nav>
  );

  const renderMobileMenu = () => {
    if (mobileBehavior !== 'hamburger') return null;

    return (
      <>
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="md:hidden p-2 hover:bg-accent rounded-md transition-colors"
          aria-label="Toggle menu"
        >
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {isMobileMenuOpen && (
          <div className="absolute top-16 left-0 right-0 bg-background border-b border-border md:hidden">
            <nav className="container mx-auto px-4 py-4 flex flex-col gap-2">
              {navItems.map((item) => (
                item.external || item.href.startsWith('#') ? (
                  <a
                    key={item.href}
                    href={item.href}
                    target={item.external ? "_blank" : undefined}
                    rel={item.external ? "noopener noreferrer" : undefined}
                    className={cn(
                      "text-sm font-medium transition-colors hover:text-primary py-2",
                      location.pathname === item.href
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link
                    key={item.href}
                    to={item.href}
                    className={cn(
                      "text-sm font-medium transition-colors hover:text-primary py-2",
                      location.pathname === item.href
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                )
              ))}
            </nav>
          </div>
        )}
      </>
    );
  };

  const getHeaderContent = () => {
    switch (variant) {
      case 'centered':
        return (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center justify-between w-full md:w-auto">
              {renderLogo()}
              {renderMobileMenu()}
            </div>
            {renderNav()}
          </div>
        );

      case 'split':
        return (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {renderLogo()}
              {navPosition === 'left' && renderNav()}
            </div>
            <div className="flex items-center gap-4">
              {navPosition === 'right' && renderNav()}
              {actions}
              {renderMobileMenu()}
            </div>
          </div>
        );

      default:
        return (
          <div className="flex h-16 items-center justify-between">
            {logoPosition === 'left' && renderLogo()}
            {navPosition === 'center' && (
              <div className="flex-1 flex justify-center">
                {renderNav()}
              </div>
            )}
            {logoPosition === 'center' && (
              <div className="flex-1 flex justify-center">
                {renderLogo()}
              </div>
            )}
            <div className="flex items-center gap-4">
              {navPosition === 'right' && renderNav()}
              {logoPosition === 'right' && renderLogo()}
              {actions}
              {renderMobileMenu()}
            </div>
          </div>
        );
    }
  };

  return (
    <header
      className={cn(
        "z-50",
        sticky && "sticky top-0",
        !sticky && "relative",
        transparent ? "bg-transparent" : "bg-background/80",
        blur && "backdrop-blur-sm",
        border && "border-b border-border",
        className
      )}
    >
      <div className="container mx-auto px-4">
        {getHeaderContent()}
      </div>
    </header>
  );
}
