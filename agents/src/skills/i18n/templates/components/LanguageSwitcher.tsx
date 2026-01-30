/**
 * Language Switcher Component
 *
 * Displays available languages and allows users to switch between them.
 * Updates both i18n language and URL path for SEO-friendly routing.
 */

import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { supportedLanguages, type Language } from '../lib/i18n/config';

interface LanguageSwitcherProps {
  /** Display style: 'dropdown' shows a select, 'buttons' shows all options */
  variant?: 'dropdown' | 'buttons';
  /** Show full language name or just code */
  showName?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export default function LanguageSwitcher({
  variant = 'dropdown',
  showName = true,
  className = '',
}: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const currentLanguage = i18n.language;

  const handleLanguageChange = (languageCode: string) => {
    i18n.changeLanguage(languageCode);

    // Update document direction for RTL languages
    const lang = supportedLanguages.find((l) => l.code === languageCode);
    if (lang) {
      document.documentElement.dir = lang.dir;
    }

    // Build pattern from supported codes to handle all formats (en, en-US, fil, etc.)
    const langPattern = supportedLanguages.map((l) => l.code).join('|');
    const regex = new RegExp(`^/(${langPattern})(/|$)`);
    const newPath = location.pathname.replace(regex, `/${languageCode}$2`);
    navigate(newPath || `/${languageCode}`);
  };

  const formatLanguageLabel = (lang: Language): string => {
    return showName ? lang.name : lang.code.toUpperCase();
  };

  if (variant === 'buttons') {
    return (
      <div className={`flex gap-2 ${className}`} role="group" aria-label="Language selection">
        {supportedLanguages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`px-3 py-1 rounded transition-colors ${
              currentLanguage === lang.code
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80'
            }`}
            aria-pressed={currentLanguage === lang.code}
            aria-label={`Switch to ${lang.name}`}
          >
            {formatLanguageLabel(lang)}
          </button>
        ))}
      </div>
    );
  }

  // Dropdown variant (default)
  return (
    <select
      value={currentLanguage}
      onChange={(e) => handleLanguageChange(e.target.value)}
      className={`px-3 py-2 rounded border bg-background ${className}`}
      aria-label="Select language"
    >
      {supportedLanguages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {formatLanguageLabel(lang)}
        </option>
      ))}
    </select>
  );
}
