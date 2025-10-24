import Website from '@/layouts/Website';
import Header, { HeaderConfig } from '@/layouts/parts/Header';
import Footer, { FooterConfig } from '@/layouts/parts/Footer';

/**
 * Root layout component that wraps all pages with consistent header and footer
 *
 * This component provides a centralized layout structure for the entire application,
 * ensuring consistent navigation and footer across all pages. It uses the Website
 * layout component and includes Header and Footer with configurable options.
 *
 * @param children - Child routes to render (typically <Outlet /> from react-router-dom)
 * @param config - Configuration for header and footer
 * @param config.header - Header configuration (logo, navigation, actions, etc.)
 * @param config.footer - Footer configuration (variant, links, social, etc.)
 *
 * @example
 * ```tsx
 * <RootLayout config={{
 *   header: {
 *     logo: { text: 'MyApp' },
 *     navItems: [{ href: '/', label: 'Home' }]
 *   },
 *   footer: {
 *     variant: 'simple'
 *   }
 * }}>
 *   <Outlet />
 * </RootLayout>
 * ```
 */
export interface RootLayoutConfig {
  header?: HeaderConfig;
  footer?: FooterConfig;
}

interface RootLayoutProps {
  children: React.ReactNode;
  config?: RootLayoutConfig;
}

export default function RootLayout({ children, config = {} }: RootLayoutProps) {
  return (
    <Website>
      {config.header && <Header config={config.header} />}
      {children}
      {config.footer && <Footer config={config.footer} />}
    </Website>
  );
}

