/**
 * Formats an array of hashtags into a display string with # prefixes
 * @param hashtags - Array of hashtag strings (without # prefix)
 * @returns Formatted string like "#tag1 #tag2 #tag3"
 */
export function formatHashtags(hashtags: string[] | undefined): string {
  if (!hashtags || hashtags.length === 0) return ''
  return hashtags.map(tag => `#${tag}`).join(' ')
}

/**
 * Capitalizes the first letter of a platform name for display
 * @param platform - Platform identifier (e.g., "facebook", "instagram")
 * @returns Capitalized platform name (e.g., "Facebook", "Instagram")
 */
export function formatPlatformName(platform: string): string {
  if (!platform) return ''
  return platform.charAt(0).toUpperCase() + platform.slice(1)
}
