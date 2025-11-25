/**
 * Tips content for the app creation screen.
 * These tips educate users about App Builder features while they wait for their preview to load.
 */

/**
 * Interface for a tip displayed during app creation.
 */
export interface Tip {
  /** Unique identifier for the tip */
  id: string
  /** Short, attention-grabbing title */
  title: string
  /** Brief description explaining the feature or best practice (1-2 sentences) */
  description: string
}

/**
 * Collection of tips about App Builder features and best practices.
 * Tips are randomized on display to provide variety for returning users.
 */
export const tips: Tip[] = [
  {
    id: 'be-specific',
    title: 'Be Specific for Better Results',
    description:
      'The more details you provide in your requests, the better the agents can help. Include examples, describe expected behavior, and mention specific files when relevant.',
  },
  {
    id: 'iterate-and-refine',
    title: 'Iterate and Refine',
    description:
      'Start with a basic request and refine it through conversation. Agents learn from your feedback and can adjust their approach based on your preferences.',
  },
  {
    id: 'explore-interface',
    title: 'Explore the Interface',
    description:
      'Use the file explorer to browse your app structure, check settings for customization options, and watch the live preview update as agents make changes.',
  },
  {
    id: 'publish-app',
    title: 'Publish Your App',
    description:
      'Once you\'re happy with your app, you can publish it to the internet. This will make your app accessible to everyone.',
  },
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
