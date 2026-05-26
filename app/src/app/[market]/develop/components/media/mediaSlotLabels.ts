export function formatSlotName(slot: string): string {
  return slot
    .split('/')
    .filter(
      (part) =>
        part &&
        part !== 'pages' &&
        part !== 'components' &&
        part !== 'sections' &&
        part !== 'layouts'
    )
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' '))
    .join(' ');
}
