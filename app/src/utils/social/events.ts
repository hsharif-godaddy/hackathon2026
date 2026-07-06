import { type SocialPostData,SocialPostState } from '@/types/social-posts'

const SOCIAL_POST_PUBLISHED = 'social:post:published'
const SOCIAL_POST_UPDATED = 'social:post:updated'

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

export function emitPostUpdated(post: SocialPostData) {
  window.dispatchEvent(new CustomEvent(SOCIAL_POST_UPDATED, { detail: { post } }))
}

export function onPostUpdated(callback: (post: SocialPostData) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ post?: SocialPostData }>).detail
    if (!detail?.post) return
    callback(detail.post)
  }
  window.addEventListener(SOCIAL_POST_UPDATED, handler)
  return () => window.removeEventListener(SOCIAL_POST_UPDATED, handler)
}
