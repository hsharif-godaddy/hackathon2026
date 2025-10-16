import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface FooterLink {
  href: string;
  label: string;
  external?: boolean;
}

export interface FooterSection {
  title: string;
  links: FooterLink[];
}

export interface SocialLink {
  href: string;
  label: string;
  icon?: React.ReactNode;
}

export interface FooterConfig {
  variant?: 'simple' | 'columns' | 'centered' | 'detailed';
  copyright?: {
    text?: string;
    showYear?: boolean;
    position?: 'left' | 'center' | 'right';
  };
  sections?: FooterSection[];
  socialLinks?: SocialLink[];
  description?: string;
  logo?: {
    text?: string;
    href?: string;
    className?: string;
  };
  bottomLinks?: FooterLink[];
  newsletter?: {
    title?: string;
    description?: string;
    placeholder?: string;
    buttonText?: string;
  };
  background?: 'default' | 'muted' | 'dark';
  border?: boolean;
}

interface FooterPatternProps {
  config?: FooterConfig;
  className?: string;
}

export default function FooterPattern({ config = {}, className }: FooterPatternProps) {
  const {
    variant = 'simple',
    copyright = {
      text: 'App',
      showYear: true,
      position: 'center'
    },
    sections = [],
    socialLinks = [],
    description,
    logo,
    bottomLinks = [],
    newsletter,
    background = 'default',
    border = true
  } = config;

  const copyrightText = `© ${copyright.showYear ? new Date().getFullYear() + ' ' : ''}${copyright.text}. All rights reserved.`;

  const renderSimpleFooter = () => (
    <div className={cn(
      "text-sm text-muted-foreground",
      copyright.position === 'center' && "text-center",
      copyright.position === 'left' && "text-left",
      copyright.position === 'right' && "text-right"
    )}>
      {copyrightText}
    </div>
  );

  const renderCenteredFooter = () => (
    <div className="flex flex-col items-center gap-6">
      {logo && (
        <Link to={logo.href || '/'} className={cn("text-xl font-bold", logo.className)}>
          {logo.text}
        </Link>
      )}

      {bottomLinks.length > 0 && (
        <nav className="flex flex-wrap gap-6 justify-center">
          {bottomLinks.map((link) => (
            link.external || link.href.startsWith('#') ? (
              <a
                key={link.href}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </a>
            ) : (
              <Link
                key={link.href}
                to={link.href}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            )
          ))}
        </nav>
      )}

      {socialLinks.length > 0 && (
        <div className="flex gap-4">
          {socialLinks.map((social) => (
            <a
              key={social.href}
              href={social.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={social.label}
            >
              {social.icon || social.label}
            </a>
          ))}
        </div>
      )}

      <div className="text-sm text-muted-foreground text-center">
        {copyrightText}
      </div>
    </div>
  );

  const renderColumnsFooter = () => (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
        {sections.map((section, index) => (
          <div key={index}>
            <h3 className="font-semibold mb-4">{section.title}</h3>
            <ul className="space-y-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  {link.external || link.href.startsWith('#') ? (
                    <a
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      to={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-sm text-muted-foreground">
          {copyrightText}
        </div>

        {socialLinks.length > 0 && (
          <div className="flex gap-4">
            {socialLinks.map((social) => (
              <a
                key={social.href}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={social.label}
              >
                {social.icon || social.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderDetailedFooter = () => (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-8">
        <div className="md:col-span-4 space-y-4">
          {logo && (
            <Link to={logo.href || '/'} className={cn("text-xl font-bold inline-block", logo.className)}>
              {logo.text}
            </Link>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
          {socialLinks.length > 0 && (
            <div className="flex gap-4">
              {socialLinks.map((social) => (
                <a
                  key={social.href}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={social.label}
                >
                  {social.icon || social.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="md:col-span-5 grid grid-cols-2 md:grid-cols-3 gap-8">
          {sections.map((section, index) => (
            <div key={index}>
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {newsletter && (
          <div className="md:col-span-3 space-y-4">
            <h3 className="font-semibold">{newsletter.title || 'Newsletter'}</h3>
            <p className="text-sm text-muted-foreground">
              {newsletter.description || 'Subscribe to our newsletter'}
            </p>
            <form className="flex flex-col gap-2">
              <input
                type="email"
                placeholder={newsletter.placeholder || 'Enter your email'}
                className="px-3 py-2 text-sm rounded-md border border-input bg-background"
              />
              <button
                type="submit"
                className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                {newsletter.buttonText || 'Subscribe'}
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-sm text-muted-foreground">
          {copyrightText}
        </div>

        {bottomLinks.length > 0 && (
          <nav className="flex flex-wrap gap-6">
            {bottomLinks.map((link) => (
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  to={link.href}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.label}
                </Link>
              )
            ))}
          </nav>
        )}
      </div>
    </div>
  );

  const getFooterContent = () => {
    switch (variant) {
      case 'centered':
        return renderCenteredFooter();
      case 'columns':
        return renderColumnsFooter();
      case 'detailed':
        return renderDetailedFooter();
      default:
        return renderSimpleFooter();
    }
  };

  return (
    <footer
      className={cn(
        "mt-auto",
        border && "border-t border-border",
        background === 'muted' && "bg-muted",
        background === 'dark' && "bg-background text-foreground",
        className
      )}
    >
      <div className="container mx-auto px-4 py-6">
        {getFooterContent()}
      </div>
    </footer>
  );
}
