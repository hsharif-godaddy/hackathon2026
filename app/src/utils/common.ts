/** Market locale from `window.gasketData.intl` (same source as Gasket intl); en-US when absent (SSR/tests). */
export function getAppLocale(): string {
  if (typeof window === 'undefined') {
    return 'en-US'
  }
  const locale = window.gasketData?.intl?.locale
  return typeof locale === 'string' && locale.length > 0 ? locale : 'en-US'
}

export const formatDate = (date: string | Date, detailed = false) => {
  const dateObj = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat(getAppLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: detailed ? '2-digit' : undefined,
    minute: detailed ? '2-digit' : undefined,
    timeZone: 'UTC',
  }).format(dateObj)
}

/**
 * Format duration in milliseconds to MM:SS format
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string (e.g., "00:05", "01:23", "99:59+")
 */
export const formatDuration = (ms: number) => {
  const maxDuration = 5999 // 99 minutes 59 seconds in seconds
  const totalSeconds = Math.floor(ms / 1000)

  if (totalSeconds > maxDuration) {
    return '99:59+'
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
