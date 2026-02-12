import { SocialPostState } from '@/types/social-posts'

const SOCIAL_POST_PUBLISHED = 'social:post:published'

export function emitPostPublished(postId: string, state: SocialPostState = SocialPostState.PUBLISHED) {
  window.dispatchEvent(new CustomEvent(SOCIAL_POST_PUBLISHED, { detail: { postId, state } }))
}

export function onPostPublished(callback: (postId: string, state: SocialPostState) => void): () => void {
  const handler = (e: Event) => {
    const { postId, state } = (e as CustomEvent).detail
    callback(postId, state)
  }
  window.addEventListener(SOCIAL_POST_PUBLISHED, handler)
  return () => window.removeEventListener(SOCIAL_POST_PUBLISHED, handler)
}
