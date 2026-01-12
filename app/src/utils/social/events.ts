const SOCIAL_POST_PUBLISHED = 'social:post:published'

export function emitPostPublished(postId: string) {
  window.dispatchEvent(new CustomEvent(SOCIAL_POST_PUBLISHED, { detail: { postId } }))
}

export function onPostPublished(callback: (postId: string) => void): () => void {
  const handler = (e: Event) => callback((e as CustomEvent).detail.postId)
  window.addEventListener(SOCIAL_POST_PUBLISHED, handler)
  return () => window.removeEventListener(SOCIAL_POST_PUBLISHED, handler)
}
