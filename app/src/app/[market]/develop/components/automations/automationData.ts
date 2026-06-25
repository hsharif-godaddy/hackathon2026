import { Automation } from '@/app/[market]/develop/components/automations/types'

type Translate = (id: string, values?: Record<string, unknown>, defaultMessage?: string) => string

export function getDefaultAutomations(t: Translate): Automation[] {
  return [
    {
      id: 'seo-optimization',
      name: t('builder_automations_default_seo_aeo_name', undefined, 'SEO and AEO'),
      description: t('builder_automations_default_seo_optimization_description', undefined, 'Meta tags, Open Graph, structured data, and sitemap'),
      prompt: 'You are an SEO/AEO expert. For each page route, recommend:\n1) 1–3 Schema.org JSON-LD @type values for the page\n2) 2–3 schema.org property names to include in JSON-LD for those types (e.g. name, url, headline, author, datePublished, address, mainEntity)\n\nRules:\n- Use standard Schema.org types and property names only.\n- Fields must be realistic for the recommended types on that page.\n- Return JSON only — no markdown or commentary.\n\nOutput shape:\n{"routes":[{"path":"/","types":["WebSite","Organization"],"fields":["name","url"]}]}',
      isDefault: true,
    },
    {
      id: 'security-analysis',
      name: t('builder_automations_default_security_analysis_name', undefined, 'Security Scan'),
      description: t('builder_automations_default_security_analysis_description', undefined, 'XSS, injection, and auth vulnerability fixes'),
      prompt: 'Perform a security analysis on this codebase. Review all source files for:\n1. Cross-site scripting (XSS) vulnerabilities\n2. SQL/NoSQL injection risks\n3. Authentication and authorization weaknesses\n4. Insecure data handling or storage\n5. Missing input validation or sanitization\n\nFor each issue found, fix it directly in the code. Provide a summary of vulnerabilities found and remediated.',
      isDefault: true,
    },
    {
      id: 'accessibility-audit',
      name: t('builder_automations_default_accessibility_audit_name', undefined, 'Accessibility'),
      description: t('builder_automations_default_accessibility_audit_description', undefined, 'WCAG 2.1 AA compliance and fixes'),
      prompt: 'Perform a WCAG 2.1 AA accessibility audit on this site. Check and fix:\n1. Color contrast ratios (minimum 4.5:1 for text, 3:1 for large text)\n2. Missing or incorrect ARIA labels and roles\n3. Keyboard navigation and focus management\n4. Missing alt text on images\n5. Form labels and error messaging\n6. Heading hierarchy and landmark regions\n\nFix all issues directly in the code and provide a summary.',
      isDefault: true,
    },
    {
      id: 'performance-optimization',
      name: t('builder_automations_default_performance_optimization_name', undefined, 'Performance'),
      description: t('builder_automations_default_performance_optimization_description', undefined, 'Lazy loading, bundle size, Core Web Vitals'),
      prompt: 'Optimize this site for performance. Apply these improvements:\n1. Add lazy loading to images and heavy components below the fold\n2. Optimize any large assets or reduce bundle size where possible\n3. Ensure proper image sizing and formats\n4. Add loading states for async content\n5. Minimize render-blocking resources\n6. Improve Largest Contentful Paint (LCP) and Cumulative Layout Shift (CLS)\n\nApply all changes directly and provide a summary of optimizations made.',
      isDefault: true,
    },
  ]
}
