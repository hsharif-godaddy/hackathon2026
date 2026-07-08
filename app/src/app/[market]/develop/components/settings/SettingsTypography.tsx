import text from '@ux/text';

interface SettingsTitleProps {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

/** Panel page title — Text Lockup XL tier (e.g. "Security Analysis"). */
export function SettingsPageTitle({ children, className, testId }: SettingsTitleProps) {
  return (
    <text.h3 as="title" size={2} className={className} data-testid={testId}>
      {children}
    </text.h3>
  );
}

/** In-panel section title — Title MD 22/27.5 (e.g. "Vulnerabilities"). */
export function SettingsSectionTitle({ children, className }: SettingsTitleProps) {
  return (
    <text.h4 as="title" size={0} className={className}>
      {children}
    </text.h4>
  );
}
