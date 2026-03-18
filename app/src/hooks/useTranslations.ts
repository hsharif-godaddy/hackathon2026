import { useIntl } from 'react-intl';

/**
 * Simplified translation hook that wraps useIntl's formatMessage
 * 
 * Provides a shorter API for translating messages in components.
 * Supports ICU MessageFormat syntax including variables, pluralization, and date/number formatting.
 * 
 * @returns Translation function that accepts an id, optional values, and optional defaultMessage
 * 
 * @example
 * ```tsx
 * const t = useTranslations();
 * 
 * // Basic translation
 * <h1>{t('builder_title')}</h1>
 * 
 * // With default message fallback
 * <span>{t('builder_beta', undefined, 'beta')}</span>
 * 
 * // With variables
 * <p>{t('greeting_message', { name: 'John' })}</p>
 * 
 * // With variables and default message
 * <p>{t('welcome_message', { name: 'John' }, 'Welcome, {name}!')}</p>
 * 
 * // With pluralization (requires ICU syntax in translation string)
 * // Translation: "You have {count, plural, one {# item} other {# items}}"
 * <p>{t('items_count', { count: 5 })}</p>
 * 
 * // With select/gender
 * // Translation: "{gender, select, male {He} female {She} other {They}} liked this"
 * <p>{t('liked_message', { gender: 'female' })}</p>
 * ```
 */
export function useTranslations() {
  const intl = useIntl();
  return (id: string, values?: Record<string, any>, defaultMessage?: string) =>
    intl.formatMessage({ id, defaultMessage }, values);
}

