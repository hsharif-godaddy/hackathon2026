# Translations in Airo Builder

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

Once translations are published through this UI, they will automatically become available to the application.

**Note:** After publishing new translations, the cache will automatically refresh after **2-5 minutes** depending on the cache layer. For immediate updates, you can clear the server cache (see [Clear Server Translation Cache](#clear-server-translation-cache)).

---

## Table of Contents

- [Overview](#overview)
- [Quick Reference](#quick-reference)
- [Architecture](#architecture)
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
- [Troubleshooting](#troubleshooting)

## Overview

This app uses **react-intl** for internationalization with translations loaded directly from the **GoDaddy Translation API**. We support both client-side and server-side translation approaches depending on your component type.

### Translation API Quick Reference

| Context                              | API                  | Import                                                      | Usage                                                                         |
| ------------------------------------ | -------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Client Component**                 | `useTranslations()`  | `import { useTranslations } from '@/hooks/useTranslations'` | `const t = useTranslations();`<br/>`t('key')`                                 |
| **Client Component (Rich Text)**     | `<FormattedMessage>` | `import { FormattedMessage } from 'react-intl'`             | `<FormattedMessage id="key" values={{...}} />`                                |
| **Client Component (Dates/Numbers)** | `useIntl()`          | `import { useIntl } from 'react-intl'`                      | `const intl = useIntl();`<br/>`intl.formatDate(date)`                         |
| **Server Component**                 | `getServerIntl()`    | `import { getServerIntl } from '@/lib/translations'`        | `const intl = await getServerIntl();`<br/>`intl.formatMessage({ id: 'key' })` |

### Current Translation Package

- **Package**: `@airo/app-builder`
- **Locale**: `en-US` (default)
- **Format**: JSON key-value pairs
- **API**: `https://api.i18n.int.gdcorp.tools/api/v2`

## Architecture

### Translation System Overview

```
┌────────────────────────────────────────────────────────────────┐
│              GoDaddy Translation API (Public)                  │
│    https://api.i18n.int.gdcorp.tools/api/v2                    │
│                   (No Authentication Required)                 │
└────────────────────────────────────────────────────────────────┘
                              │
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌──────────────────┐          ┌──────────────────┐
    │  Server-Side     │          │  Client-Side     │
    │  (Direct Call)   │          │  (Fallback)      │
    └──────────────────┘          └──────────────────┘
              │                               │
              ▼                               ▼
    loadTranslations()           /api/i18n/package
    (No HTTP overhead)           (Next.js API route)
              │                               │
              │                               └──→ loadTranslations()
              │                                          │
              ▼                                          ▼
    ┌─────────────────────────────────────────────────────┐
    │              Multi-Layer Caching                    │
    │                                                     │
    │  1. Map Cache (5 min) - server-intl.ts             │
    │  2. Next.js Data Cache (2 min) - loadTranslations  │
    │  3. CDN Cache (2 min) - API route                  │
    └─────────────────────────────────────────────────────┘
```

### Industry Standard Pattern

This app follows **Next.js best practices**:

- ✅ **Server Components** → Call `loadTranslations()` directly (no HTTP)
- ✅ **Client Components** → Use React Query hook → API route → `loadTranslations()`
- ✅ **No authentication required** - Public translation API
- ✅ **Smart caching** - Multiple layers for optimal performance
- ✅ **Resilient fallback** - Client-side fetch if server-side fails

### How It Works

#### Server-Side Flow (Primary)

```typescript
// layout.tsx or Server Component
const messages = await loadTranslations("en-US", ["@airo/app-builder"]);
// ↓ Direct call to translation API (no HTTP overhead)
// ↓ Result: 86 translations in ~50ms (first call)
// ↓ Result: 86 translations in <1ms (cached)
```

#### Client-Side Flow (Fallback Only)

```typescript
// TranslationsProvider detects missing server-side messages
// ↓ Triggers useTranslationPackages() hook
// ↓ Fetches via /api/i18n/package?packageName=...&locale=en-US
// ↓ API route calls loadTranslations() internally
// ↓ Result: Client always gets translations
```

### Key Files

| File                         | Purpose                         | Usage                                             |
| ---------------------------- | ------------------------------- | ------------------------------------------------- |
| `load-translations.ts`       | Core utility - Direct API calls | Server components, API routes                     |
| `fetch-translations.ts`      | Client-side HTTP fetcher        | React Query hooks only                            |
| `server-intl.ts`             | Server-side `IntlShape` factory | Server components (when you need `intl` instance) |
| `useTranslationPackages.ts`  | React Query hook                | Client-side fallback                              |
| `TranslationsProvider.tsx`   | React context provider          | Root layout                                       |
| `/api/i18n/package/route.ts` | Public API endpoint             | Client-side fallback requests                     |

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

### Server Component (Direct Loading)

```typescript
import { loadTranslations } from '@/lib/translations';

export default async function MyPage() {
  const messages = await loadTranslations('en-US', ['@airo/app-builder']);

  return (
    <div>
      <h1>{messages['builder_project_domain_title']}</h1>
    </div>
  );
}
```

## Client-Side Translations

### Setup

The app is already configured with the `TranslationsProvider` in the root layout:

```typescript
// app/src/app/layout.tsx
import { TranslationsProvider } from '@/components/providers/TranslationProvider';
import { loadTranslations, detectLocale } from '@/lib/translations';

export default async function RootLayout({ children }) {
  const locale = await detectLocale();
  let messages;

  try {
    // Server-side: Load translations directly (no HTTP)
    messages = await loadTranslations(locale, ['@airo/app-builder']);
  } catch (error) {
    // Client-side will handle fallback
  }

  return (
    <html>
      <body>
        <TranslationsProvider
          locale={locale}
          messages={messages}
          packages={['@airo/app-builder']}
        >
          {children}
        </TranslationsProvider>
      </body>
    </html>
  );
}
```

### How Fallback Works

**If server-side loading fails:**

1. ✅ `messages` is `undefined`
2. ✅ `TranslationsProvider` detects missing messages
3. ✅ Triggers `useTranslationPackages()` (client-side fetch)
4. ✅ Shows `LoadingComponent` while fetching
5. ✅ Translations load successfully from API route
6. ✅ User sees fully translated UI

**This ensures translations ALWAYS work**, even if:

- Server-side fetch fails
- Network issues occur
- API is temporarily unavailable

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

// Translation string in API:
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

// Translation string:
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
import LoadingComponent from '@/components/auth/LoadingComponent';

export default function ComponentWithLoading() {
  const { translationsLoading, translationsError, translationsSuccess } = useTranslationsState();

  if (translationsLoading) return <LoadingComponent />;
  if (translationsError) return <Error message="Failed to load translations" />;
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

### Using `loadTranslations()` Directly

For simpler use cases, load translations directly:

```typescript
import { loadTranslations, detectLocale } from '@/lib/translations';

export default async function ServerPage() {
  const locale = await detectLocale();
  const messages = await loadTranslations(locale, ['@airo/app-builder']);

  return (
    <div>
      <h1>{messages['builder_project_domain_title']}</h1>
      <p>{messages['builder_beta']}</p>
    </div>
  );
}
```

**When to use `loadTranslations()` vs `getServerIntl()`:**

- ✅ Use `loadTranslations()` when you just need the raw translations object
- ✅ Use `getServerIntl()` when you need formatting capabilities (dates, numbers, plurals)

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

// ✅ Server Component - Use getServerIntl() or loadTranslations()
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

### Use Server-Side (`getServerIntl()` or `loadTranslations()`) For:

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
  "builder_beta": "Beta",
  "builder_title": "Airo Builder"
  // Add more as they're added to the package
}
```

To see all available keys, check the i18n management UI or inspect the API response.

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

// ✅ Good: Server Component with loadTranslations (simpler)
import { loadTranslations, detectLocale } from '@/lib/translations';

export default async function Article() {
  const locale = await detectLocale();
  const messages = await loadTranslations(locale, ['@airo/app-builder']);
  return <article>{messages['article_title']}</article>;
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

**Multi-Layer Caching:**

```
Request Flow:
  1. Map Cache (5 min TTL) → < 1ms
  2. Next.js Data Cache (2 min) → ~10ms
  3. Translation API → ~50ms (first call only)
```

**Performance tips:**

1. ✅ Caching is automatic - no configuration needed
2. ✅ First request: ~50ms (fetches from API)
3. ✅ Cached requests: < 1ms (Map cache hit)
4. ✅ Cache refreshes automatically every 2-5 minutes
5. ✅ Server-side always faster than client-side (no HTTP overhead)

**Cache layers:**

- **Layer 1**: Map cache (5 min) - Fastest, in-memory
- **Layer 2**: Next.js Data Cache (2 min) - Fast, per-request
- **Layer 3**: CDN Cache (2 min) - For client-side requests only
- **Source**: Translation API - Only on cache miss

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

// Or with loadTranslations
const messages = await loadTranslations("en-US", [
  "@airo/app-builder",
  "@airo/shared-components",
]);
```

## Related Files

### Core Translation Files

- **Core Utility (Server-side)**: `app/src/lib/translations/load-translations.ts` **Direct API calls**
- **Client Fetcher**: `app/src/lib/translations/fetch-translations.ts` (Client-side only)
- **Server IntlShape Factory**: `app/src/lib/translations/server-intl.ts`
- **Client Provider**: `app/src/components/providers/TranslationProvider.tsx`
- **Client Hook (Simplified)**: `app/src/hooks/useTranslations.ts` **Recommended**
- **Client Hook (Packages)**: `app/src/hooks/useTranslationPackages.ts`
- **Public API Route**: `app/src/app/api/i18n/package/route.ts`

### Documentation

- **This README**: `app/src/lib/translations/README.md`

## External Resources

- [GoDaddy Translation API](https://api.i18n.int.gdcorp.tools/api/v2)
- [i18n Management UI](https://i18n.int.gdcorp.tools/org/hcx/app/airo-app-builder)
- [React Intl Documentation](https://formatjs.io/docs/react-intl/)
- [Next.js Internationalization](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [ICU Message Syntax](https://formatjs.io/docs/core-concepts/icu-syntax/)
