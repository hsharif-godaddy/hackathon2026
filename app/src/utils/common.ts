export const formatDate = (date: string | Date, detailed = false) => {
  const dateObj = date instanceof Date ? date : new Date(date)
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: detailed ? '2-digit' : undefined,
    minute: detailed ? '2-digit' : undefined,
    timeZone: 'UTC',
  }).format(dateObj)
}

/**
 * Get the user's locale from the browser, with fallback to en-US
 *
 * @returns User's locale (e.g., "en-US", "es-ES", "fr-FR")
 */
export const getUserLocale = (): string => {
  return typeof navigator !== 'undefined' ? navigator.language : 'en-US'
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
