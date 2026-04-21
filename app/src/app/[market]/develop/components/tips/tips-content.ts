/**
 * Tips content for the app creation screen.
 * These tips educate users about App Builder features while they wait for their preview to load.
 */

/**
 * Collection of tips about App Builder features and best practices.
 * Tips are randomized on display to provide variety for returning users.
 * Translations for title and description are in the i18n tool
 */
export const tips: string[] = [
  'be-specific',
  'iterate-and-refine',
  'explore-interface',
  'publish-app'
]

/**
 * Shuffles an array using the Fisher-Yates algorithm.
 * Used to randomize tip order on each app creation.
 *
 * @param array - The array to shuffle
 * @returns A new shuffled array
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
