---
name: i18n
description: Multi-language website support with translations, language routing, and localized content
dependencies:
  - react-i18next
  - i18next
  - i18next-browser-languagedetector
---

# Internationalization (i18n) Skill

Set up multi-language support for v8 template websites.

## Critical Rules

1. **ALL user-visible text** must use translation keys - no hardcoded strings
2. **ALL requested languages** must have complete translation files
3. **ALL internal links** must include language prefix (`/en/about`, `/es/about`)

## Setup Steps

### 1. Install Templates

```typescript
skill({ action: 'install', skill: 'i18n' });
```

Installs:

- `src/lib/i18n/config.ts` - Language configuration
- `src/lib/i18n/index.ts` - i18n initialization
- `src/components/LanguageSwitcher.tsx` - Language switcher
- `src/components/LanguageWrapper.tsx` - Route wrapper
- `src/hooks/useLocalizedPath.ts` - Link helper hook

### 2. Initialize in main.tsx

Add before App import:

```typescript
import './lib/i18n';
```

### 3. Create Translation Files

One file per language: `src/locales/{lang}.json`

```
src/locales/
├── en.json
└── es.json
```

Example `en.json`:

```json
{
  "nav": { "home": "Home", "about": "About" },
  "home": { "title": "Welcome", "subtitle": "..." },
  "about": { "title": "About Us" }
}
```

Update `src/lib/i18n/index.ts` to import translations:

```typescript
import en from '../../locales/en.json';
import es from '../../locales/es.json';

const resources = {
  en: { translation: en },
  es: { translation: es },
};
```

### 4. Update config.ts

Set supported languages and default:

```typescript
export const supportedLanguages = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
];
export const defaultLanguage = 'en';
```

### 5. Update App.tsx for Language Routing

Wrap routes with `LanguageWrapper` under `/:lang` pattern:

- Root `/` redirects to `/${defaultLanguage}`
- `LanguageWrapper` receives children (not Outlet)
- **routes.tsx**: Use relative paths (`index: true`, `path: 'about'`) not absolute (`/about`)

### 6. Update Header.tsx

- Add `LanguageSwitcher` component
- Update nav links to include language prefix: `/${i18n.language}/about`
- Translate nav labels: `t('nav.about')`

### 7. Convert All Components

Replace hardcoded text with translation keys:

```tsx
const { t } = useTranslation();
<h1>{t('home.title')}</h1>;
```

Use `useLocalizedPath` hook for internal links:

```tsx
const localizedPath = useLocalizedPath();
<Link to={localizedPath('/about')}>About</Link>;
```

## Translation Patterns

**Interpolation:** `t('greeting', { name: 'John' })` → `"Hello, {{name}}!"`

**Pluralization:**

```json
{ "items_one": "{{count}} item", "items_other": "{{count}} items" }
```

**Date/Number:** Use `Intl.DateTimeFormat(i18n.language)` and `Intl.NumberFormat`

## RTL Languages (Arabic, Hebrew)

Set `dir: 'rtl'` in config. Components handle `document.documentElement.dir` automatically.

Add CSS logical properties: `margin-inline-start`, `padding-inline-end`

## SEO

Set `<html lang>` attribute in LanguageWrapper. For hreflang tags, add to page head manually.

## Checklist

- [ ] Templates installed
- [ ] i18n initialized in main.tsx
- [ ] Translation files created for all languages
- [ ] All text uses translation keys
- [ ] All links include language prefix
- [ ] Language switcher in navigation
- [ ] App.tsx has language routing
- [ ] routes.tsx uses relative paths (no leading `/`)
