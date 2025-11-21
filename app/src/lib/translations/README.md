# Translations in Airo App Builder

Comprehensive guide to using translations in both Client Components and Server Components.

## 🌐 Managing Translations

**Want to add or update translations?** Use the GoDaddy i18n Management UI:

**[https://i18n.int.gdcorp.tools/org/hcx/app/airo-app-builder](https://i18n.int.gdcorp.tools/org/hcx/app/airo-app-builder)**

**NOTE: you must first add yourself to the `PARTNERSTRANSLATIONS` ad group**

This web interface allows you to:

- ✅ Add new translation keys and values
- ✅ Update existing translations
- ✅ Manage translations across multiple locales
- ✅ Preview changes before publishing

Once translations are published through this UI, they will automatically become available to the application through the BFF i18n service endpoint.

**Note:** After publishing new translations, the server cache will automatically refresh after **5 minutes**. For immediate updates, you can clear the server cache (see [Clear Server Translation Cache](#clear-server-translation-cache)).

---

## Table of Contents

- [Overview](#overview)
- [Quick Reference](#quick-reference)
- [Client-Side Translations](#client-side-translations)
  - [Using useTranslations()](#using-the-usetranslations-hook-recommended)
  - [Pluralization](#pluralization)
  - [Rich Text Formatting](#rich-text-formatting-bold-links-etc)
  - [When to Use Which API](#when-to-use-which-api)
- [Server-Side Translations](#server-side-translations)
- [When to Use Which](#when-to-use-which)
- [Available Translation Keys](#available-translation-keys)
- [Best Practices](#best-practices)
- [Advanced Topics](#advanced-topics)

## Overview

This app uses **react-intl** for internationalization with translations loaded from the BFF i18n service. We support both client-side and server-side translation approaches depending on your component type.

### Translation API Quick Reference

| Context                              | API                  | Import                                                      | Usage                                                                         |
| ------------------------------------ | -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Client Component**                 | `useTranslations()`  | `import { useTranslations } from '@/hooks/useTranslations'` | `const t = useTranslations();`<br/>`t('key')`                                 |
| **Client Component (Rich Text)**     | `<FormattedMessage>` | `import { FormattedMessage } from 'react-intl'`             | `<FormattedMessage id="key" values={{...}} />`                                |
| **Client Component (Dates/Numbers)** | `useIntl()`          | `import { useIntl } from 'react-intl'`                      | `const intl = useIntl();`<br/>`intl.formatDate(date)`                         |
| **Server Component**                 | `getServerIntl()`    | `import { getServerIntl } from '@/lib/translations'`        | `const intl = await getServerIntl();`<br/>`intl.formatMessage({ id: 'key' })` |

### Translation System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BFF i18n Endpoint                        │
│         https://bff.pcx.{domain}/api/i18n/package           │
└─────────────────────────────────────────────────────────────┘
                              │
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐            ┌─────────────────┐
    │ Client-Side     │            │ Server-Side     │
    │ (useIntl hook)  │            │ (getServerIntl) │
    │                 │            │                 │
    │ • Interactive   │            │ • Static        │
    │ • Forms         │            │ • Metadata      │
    │ • Real-time     │            │ • SEO           │
    └─────────────────┘            └─────────────────┘
```

### Current Translation Package

- **Package**: `@airo/app-builder`
- **Locale**: `en-US` (default)
- **Format**: JSON key-value pairs

## Quick Reference

### Client Component (Interactive UI) - Recommended

```typescript
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function MyComponent() {
  const t = useTranslations();

  return (
    <h1>{t('builder_project_domain_title')}</h1>
  );
}
```

### Server Component (Static Content)

```typescript
import { getServerIntl } from '@/lib/translations';

export default async function MyComponent() {
  const intl = await getServerIntl();

  return (
    <h1>{intl.formatMessage({ id: 'builder_project_domain_title' })}</h1>
  );
}
```

## Client-Side Translations

### Setup

The app is already configured with the `TranslationProvider` in the root layout:

```typescript
// app/src/app/layout.tsx
import { TranslationsProvider } from '@/components/providers/TranslationProvider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <TranslationsProvider packages={['@airo/app-builder']}>
          {children}
        </TranslationsProvider>
      </body>
    </html>
  );
}
```

### Using the `useTranslations()` Hook (Recommended)

The `useTranslations()` hook provides a simplified API for translating messages in client components.

**Basic usage:**

```typescript
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function ProjectDomain() {
  const t = useTranslations();

  return (
    <div>
      <h1>{t('builder_project_domain_title')}</h1>
      <p>{t('builder_beta')}</p>
    </div>
  );
}
```

**With variables:**

```typescript
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function Greeting({ name }) {
  const t = useTranslations();

  return (
    <p>{t('greeting_message', { name })}</p>
  );
}

// Translation string: "Hello, {name}! Welcome back."
```

**With default message fallback:**

```typescript
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function Header() {
  const t = useTranslations();

  return (
    <span>{t('builder_beta', undefined, 'beta')}</span>
  );
}

// If translation key is missing, displays "beta"
```

### Pluralization

Use ICU MessageFormat syntax in your translation strings for pluralization:

```typescript
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function ItemCount({ count }) {
  const t = useTranslations();

  return (
    <p>{t('items_in_cart', { count })}</p>
  );
}

// Translation string in BFF:
// "items_in_cart": "You have {count, plural, =0 {no items} one {# item} other {# items}} in your cart"
//
// Results:
// count = 0  → "You have no items in your cart"
// count = 1  → "You have 1 item in your cart"
// count = 5  → "You have 5 items in your cart"
```

**Common pluralization patterns:**

```typescript
// Simple plural
"{count, plural, one {# item} other {# items}}";

// With zero case
"{count, plural, =0 {no items} one {# item} other {# items}}";

// Complex pluralization
"{count, plural, =0 {No messages} =1 {One message} other {# messages}}";

// Select with gender
"{gender, select, male {He} female {She} other {They}} liked this";
```

### Rich Text Formatting (Bold, Links, etc.)

For translations that need rich text formatting (bold, italic, links), use the `<FormattedMessage>` component:

```typescript
'use client';
import { FormattedMessage } from 'react-intl';
import text from '@ux/text';

export default function PublishSuccess({ domain }) {
  return (
    <p>
      <FormattedMessage
        id='builder_publish_success_message'
        values={{
          fqdn: domain,
          strong: (chunks) => <text.strong>{chunks}</text.strong>
        }}
      />
    </p>
  );
}

// Translation string in BFF:
// "builder_publish_success_message": "Your app is live at <strong>{fqdn}</strong>"
//
// Result: "Your app is live at **example.com**"
```

**Rich text patterns:**

```typescript
// Bold text
values={{
  strong: (chunks) => <strong>{chunks}</strong>
}}
// Translation: "This is <strong>important</strong>"

// Links
values={{
  link: (chunks) => <a href="/docs">{chunks}</a>
}}
// Translation: "Read the <link>documentation</link>"

// Multiple formatters
values={{
  name: userName,
  bold: (chunks) => <strong>{chunks}</strong>,
  link: (chunks) => <a href="/profile">{chunks}</a>
}}
// Translation: "Welcome <bold>{name}</bold>! <link>View your profile</link>"
```

### When to Use Which API

**Use `t()` for:**

- ✅ Simple text translations
- ✅ Translations with variables
- ✅ Most common use cases

```typescript
const t = useTranslations();
<h1>{t('page_title')}</h1>
<p>{t('greeting', { name })}</p>
```

**Use `<FormattedMessage>` for:**

- ✅ Rich text formatting (bold, italic, links)
- ✅ Complex HTML structures in translations
- ✅ When you need JSX inside translated text

```typescript
<FormattedMessage
  id="message"
  values={{
    strong: (chunks) => <strong>{chunks}</strong>
  }}
/>
```

**Use `useIntl()` for:**

- ✅ Date/time/number formatting
- ✅ When you need the full `intl` API

```typescript
const intl = useIntl();
intl.formatDate(new Date());
intl.formatNumber(1234.56);
```

**Format dates and numbers:**

```typescript
'use client';
import { useIntl } from 'react-intl';

export default function FormattingExample() {
  const intl = useIntl();
  const now = new Date();

  return (
    <div>
      {/* Date formatting */}
      <p>{intl.formatDate(now, { year: 'numeric', month: 'long', day: 'numeric' })}</p>

      {/* Time formatting */}
      <p>{intl.formatTime(now, { hour: '2-digit', minute: '2-digit' })}</p>

      {/* Number formatting */}
      <p>{intl.formatNumber(1234.56)}</p>

      {/* Currency formatting */}
      <p>{intl.formatNumber(99.99, { style: 'currency', currency: 'USD' })}</p>

      {/* Percentage formatting */}
      <p>{intl.formatNumber(0.75, { style: 'percent' })}</p>

      {/* Relative time */}
      <p>{intl.formatRelativeTime(-1, 'day')}</p> {/* "1 day ago" */}

      {/* List formatting */}
      <p>{intl.formatList(['Apple', 'Banana', 'Orange'])}</p>
    </div>
  );
}
```

### Translation Loading State

Check if translations are loaded:

```typescript
'use client';
import { useTranslationsState } from '@/components/providers/TranslationProvider';

export default function ComponentWithLoading() {
  const { translationsLoading, translationsError, translationsSuccess } = useTranslationsState();

  if (translationsLoading) return <Spinner />;
  if (translationsError) return <Error />;
  if (!translationsSuccess) return null;

  return <MyComponent />;
}
```

## Server-Side Translations

### Using `getServerIntl()`

For Server Components, use the `getServerIntl()` utility:

```typescript
import { getServerIntl } from '@/lib/translations';

export default async function ServerPage() {
  const intl = await getServerIntl();

  return (
    <div>
      <h1>{intl.formatMessage({ id: 'builder_project_domain_title' })}</h1>
      <p>{intl.formatMessage({ id: 'builder_beta' })}</p>
    </div>
  );
}
```

### Options

**Custom locale:**

```typescript
const intl = await getServerIntl({
  locale: "es-ES",
});
```

**Multiple packages:**

```typescript
const intl = await getServerIntl({
  packages: ["@airo/app-builder", "@airo/shared"],
});
```

**Disable caching (for testing):**

```typescript
const intl = await getServerIntl({
  useCache: false,
});
```

### Metadata Generation

Translate page metadata for SEO:

```typescript
import { getServerIntl } from '@/lib/translations';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const intl = await getServerIntl();

  return {
    title: intl.formatMessage({ id: 'page_title' }),
    description: intl.formatMessage({ id: 'page_description' }),
    openGraph: {
      title: intl.formatMessage({ id: 'page_title' }),
      description: intl.formatMessage({ id: 'page_description' }),
    },
  };
}

export default async function Page() {
  return <div>Content here</div>;
}
```

### API Routes

Use in API routes for translated responses:

```typescript
import { getServerIntl } from "@/lib/translations";
import { NextResponse } from "next/server";

export async function GET() {
  const intl = await getServerIntl();

  const message = intl.formatMessage({ id: "api_success_message" });

  return NextResponse.json({ message });
}
```

## When to Use Which

### Client vs Server: Critical Difference

**⚠️ Important:** You **cannot** use React hooks in Server Components.

```typescript
// ✅ Client Component - Use useTranslations() hook
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function ClientComponent() {
  const t = useTranslations(); // ✅ Hook works here
  return <div>{t('title')}</div>;
}

// ✅ Server Component - Use getServerIntl()
import { getServerIntl } from '@/lib/translations';

export default async function ServerComponent() {
  const intl = await getServerIntl(); // ✅ Async works here
  return <div>{intl.formatMessage({ id: 'title' })}</div>;
}

// ❌ Server Component - Cannot use hooks
export default async function ServerComponent() {
  const t = useTranslations(); // ❌ Error: Hooks don't work in Server Components
  return <div>{t('title')}</div>;
}

// ❌ Client Component - Cannot use await
'use client';
export default function ClientComponent() {
  const intl = await getServerIntl(); // ❌ Error: Cannot use await in Client Components
  return <div>{intl.formatMessage({ id: 'title' })}</div>;
}
```

### Use Client-Side (`useTranslations()` hook) For:

✅ **Interactive Components**

- Forms with inputs
- Buttons with onClick handlers
- Components with useState/useEffect
- Real-time updates
- User interactions

✅ **Examples in This App**

- ProjectDomain component (form inputs)
- DomainAttach component (form submission)
- Chat interface
- Any component with `'use client'`

```typescript
'use client'; // ← Needs 'use client' directive
import { useTranslations } from '@/hooks/useTranslations';
import { useState } from 'react';

export default function InteractiveForm() {
  const t = useTranslations();
  const [value, setValue] = useState('');

  return (
    <form>
      <label>{t('form_label')}</label>
      <input value={value} onChange={(e) => setValue(e.target.value)} />
    </form>
  );
}
```

### Use Server-Side (`getServerIntl()`) For:

✅ **Static Content**

- Marketing pages
- Documentation
- Blog posts
- Static text sections

✅ **SEO-Critical Content**

- Page titles and descriptions
- Open Graph metadata
- Schema.org markup

✅ **API Responses**

- Translated error messages
- Email templates
- Server-generated content

```typescript
// No 'use client' - Server Component
import { getServerIntl } from '@/lib/translations';

export default async function StaticPage() {
  const intl = await getServerIntl();

  return (
    <article>
      <h1>{intl.formatMessage({ id: 'article_title' })}</h1>
      <p>{intl.formatMessage({ id: 'article_content' })}</p>
    </article>
  );
}
```

## Available Translation Keys

Current keys in `@airo/app-builder`:

```typescript
{
  "builder_project_domain_title": "Project Domain",
  "builder_beta": "Beta"
  // Add more as they're added to the package
}
```

## Best Practices

### 1. Use the Right Tool for the Job

```typescript
// ✅ Good: Client Component with useTranslations hook
'use client';
import { useTranslations } from '@/hooks/useTranslations';

export default function Form() {
  const t = useTranslations();
  return <input placeholder={t('form_placeholder')} />;
}

// ✅ Good: Server Component with getServerIntl
import { getServerIntl } from '@/lib/translations';

export default async function Article() {
  const intl = await getServerIntl();
  return <article>{intl.formatMessage({ id: 'article_title' })}</article>;
}

// ❌ Bad: Server Component trying to use client hooks
export default async function Form() {
  const t = useTranslations(); // ❌ Error: can't use hooks in Server Components
  return <input />;
}
```

### 2. Translation Key Naming

```typescript
// ✅ Good: Descriptive, hierarchical keys
"builder_project_domain_title";
"builder_project_domain_description";
"builder_form_submit_button";
"builder_error_network_timeout";

// ❌ Bad: Vague, generic keys
"title";
"text1";
"button";
```

### 3. Performance Considerations

**Client-side:**

- ✅ Translations are cached by React Query
- ✅ Loaded once on app initialization
- ✅ Shared across all Client Components

**Server-side:**

- ✅ Translations are cached in memory for **5 minutes**
- ✅ Next.js fetch cache enabled
- ✅ First request is slower, subsequent requests are fast
- ✅ Cache expires after 5 minutes and refetches fresh translations

**Performance tips:**

1. Keep default caching enabled
2. First request will be slower (fetches from BFF: ~1-2 seconds)
3. Subsequent requests use cached data (< 1ms)
4. Cache automatically refreshes every 5 minutes
5. After cache expiration, Next.js fetch cache may still serve cached data (~100-500ms)

## Advanced Topics

### Dynamic Locale Support

If you need to support multiple locales:

```typescript
// app/[locale]/page.tsx
import { getServerIntl } from '@/lib/translations';

export default async function Page({
  params
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params;
  const intl = await getServerIntl({ locale });

  return <h1>{intl.formatMessage({ id: 'page_title' })}</h1>;
}
```

### Clear Server Translation Cache

The server-side translation cache automatically expires after **5 minutes**. However, you can manually clear the cache for testing or immediate updates:

```typescript
import { clearServerIntlCache } from "@/lib/translations";

// In a test or admin endpoint
clearServerIntlCache();
```

**When to clear the cache:**

- 🧪 During testing
- 🚀 After deploying new translations (for immediate updates)
- 🔄 When debugging translation issues

**Note:** The cache will automatically repopulate on the next request.

### Multiple Translation Packages

Load translations from multiple sources:

```typescript
const intl = await getServerIntl({
  packages: ["@airo/app-builder", "@airo/shared-components", "@airo/marketing"],
});
```

## Related Files

### Core Translation Files

- **Client Provider**: `app/src/components/providers/TranslationProvider.tsx`
- **Client Hook (Simplified)**: `app/src/hooks/useTranslations.ts` **Recommended**
- **Client Hook (Packages)**: `app/src/hooks/useTranslationPackages.ts`
- **Server Utility**: `app/src/lib/translations/server-intl.ts`
- **Fetch Utility**: `app/src/lib/translations/fetch-translations.ts`

### Documentation

- **This README**: `app/src/lib/translations/README.md`

## External Resources

- [PCX Translation Tool Documentation](https://docs.pcx.int.gdcorp.tools/docs/category/translation-tool/)
- [React Intl Documentation](https://formatjs.io/docs/react-intl/)
- [Next.js Internationalization](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [ICU Message Syntax](https://formatjs.io/docs/core-concepts/icu-syntax/)
