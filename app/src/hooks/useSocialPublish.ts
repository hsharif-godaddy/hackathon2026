import { useCallback, useState } from 'react'

import { useWebSocketContext } from '@/contexts/WebSocketContext'
import { useTranslations } from '@/hooks/useTranslations'
import { useUserLocale } from '@/hooks/useUserLocale'
import { PLATFORM_TRANSFORMS } from '@/lib/social-platforms'
import { CONNECT_REQUEST_FROM_PUBLISH, type SiteAssociation } from '@/types/social'
import { PublishTiming, SocialPostData } from '@/types/social-posts'
import { formatHashtags, formatPlatformName } from '@/utils/social/format'
import { parseTimeToDate } from '@/utils/social/scheduling'

interface UseSocialPublishOptions {
    associations?: SiteAssociation[]
    onSave?: (post: SocialPostData) => void
    onPublish?: (post: SocialPostData) => void
    onComplete?: () => void
}

interface PublishParams {
    post: SocialPostData
    timing: PublishTiming
    scheduleDate: string[]
    scheduleTime: string
}

interface UseSocialPublishReturn {
    isPublishing: boolean
    publish: (params: PublishParams) => Promise<void>
}

/**
 * Custom hook for handling social post publishing logic
 * Manages connection verification, message formatting, and WebSocket communication
 */
export function useSocialPublish({
    associations = [],
    onSave,
    onPublish,
    onComplete,
}: UseSocialPublishOptions): UseSocialPublishReturn {
    const t = useTranslations()
    const locale = useUserLocale()
    const { sendMessage } = useWebSocketContext()
    const [isPublishing, setIsPublishing] = useState(false)

    const publish = useCallback(
        async ({ post, timing, scheduleDate, scheduleTime }: PublishParams) => {
            let scheduledAt: Date | undefined = undefined

            // Parse scheduled time if applicable
            if (timing === PublishTiming.LATER && scheduleDate.length && scheduleTime) {
                const dateObj = new Date(scheduleDate[0])
                parseTimeToDate(dateObj, scheduleTime)
                scheduledAt = dateObj
            }

            setIsPublishing(true)

            try {
                const hasConnection = associations.some(
                    (a) => a.platform.toLowerCase() === post.platform.toLowerCase()
                )

                const platformName = formatPlatformName(post.platform)

                // Save post data
                if (onSave) {
                    onSave(post)
                }

                // Prepare publish payload
                const message = [post.content, post.callToAction, formatHashtags(post.hashtags)]
                    .filter(Boolean)
                    .join('\n\n')
                const imageUrls = post.images?.map((img) => img.url) || []
                const platform = PLATFORM_TRANSFORMS.toDisplay(post.platform)

                const pendingPublish = {
                    platforms: [platform],
                    platformData: [{
                        platform,
                        message,
                        imageUrls,
                        scheduledAt
                    }],
                    message,
                    imageUrls,
                    scheduledAt
                }

                if (hasConnection) {
                    // Platform already connected - send publish message
                    const chatMessage = scheduledAt
                        ? t('builder_social_chat_schedule', {
                            styleName: post.styleLabel,
                            platformName,
                            dateTime: scheduledAt.toLocaleString(locale, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true,
                            }),
                        })
                        : t('builder_social_chat_publish', {
                            styleName: post.styleLabel,
                            platformName,
                        })

                    await sendMessage({
                        content: chatMessage,
                        isActionRequest: false,
                        customContext: {
                            type: 'social_publish_ready',
                            data: {
                                platform: post.platform,
                                connectionVerified: true,
                                pendingPublish,
                                postData: post,
                            },
                            persistence: 'save',
                        }
                    })
                } else {
                    // No connection - prompt user to connect
                    await sendMessage({
                        content: `Connect to ${platformName}`,
                        isActionRequest: false,
                        customContext: {
                            type: CONNECT_REQUEST_FROM_PUBLISH,
                            data: {
                                platform: post.platform,
                                pendingPublish,
                                postData: post,
                            },
                            persistence: 'save',
                        }
                    })
                }

                if (onPublish) {
                    onPublish(post)
                }

                if (onComplete) {
                    onComplete()
                }
            } finally {
                setIsPublishing(false)
            }
        },
        [associations, locale, onSave, onPublish, onComplete, t, sendMessage]
    )

    return {
        isPublishing,
        publish,
    }
}
