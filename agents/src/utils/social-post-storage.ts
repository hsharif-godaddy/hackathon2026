import { SocialPost } from '../types/social-posts.js'
import { logger } from '../logging/index.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'

const SOCIAL_POSTS_FILE = 'src/data/social-posts.json'

/**
 * Read social posts from JSON file
 * @param appPath - Path to the app directory
 * @returns Array of selected social posts
 */
export async function readSocialPostsFromFile(appPath: string): Promise<SocialPost[]> {
  const filePath = join(appPath, SOCIAL_POSTS_FILE)

  try {
    if (!existsSync(filePath)) {
      return []
    }
    const content = await readFile(filePath, 'utf-8')
    const data = JSON.parse(content)
    return data.posts || []
  } catch (error) {
    logger.warn('socialPost.file.read.failed', {
      appPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

/**
 * Write social posts to JSON file
 * @param appPath - Path to the app directory
 * @param posts - Array of selected social posts to save
 */
export async function writeSocialPostsToFile(appPath: string, posts: SocialPost[]): Promise<void> {
  const filePath = join(appPath, SOCIAL_POSTS_FILE)
  const dirPath = dirname(filePath)

  try {
    if (!existsSync(dirPath)) {
      await mkdir(dirPath, { recursive: true })
    }

    const data = {
      posts,
      updatedAt: new Date().toISOString(),
      totalCount: posts.length
    }

    await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')

    logger.info('socialPost.file.write.success', {
      appPath,
      postCount: posts.length
    })
  } catch (error) {
    logger.error('socialPost.file.write.failed', {
      appPath,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

/**
 * Generate a unique ID for social posts
 * @returns A unique identifier string
 */
export function generateUniqueId(): string {
  return `sp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
