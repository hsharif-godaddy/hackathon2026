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
