/* eslint-disable react/display-name */
/* eslint-disable @next/next/no-img-element */
'use client'

import clsx from 'clsx'
import { memo, useMemo } from 'react'
import AlertIcon from '@ux/icon/alert'
import CommentIcon from '@ux/icon/chat'
import FacebookIcon from '@ux/icon/facebook'
import ShareIcon from '@ux/icon/forward'
import InstagramIcon from '@ux/icon/instagram'
import LikeIcon from '@ux/icon/thumbs-up'
import { text } from '@ux/text'

import { useAppImageUrl } from '@/app/develop/hooks/useAppImageUrl'
import { useTranslations } from '@/hooks/useTranslations'
import { SocialPlatform } from '@/types/social'
import { SocialPostData } from '@/types/social-posts'
import { formatHashtags } from '@/utils/social/format'

/**
 * Platform icon mapping
 */
const PlatformIcon = {
  facebook: <FacebookIcon className="w-4 h-4" />,
  instagram: <InstagramIcon className="w-4 h-4" />
}

/**
 * Renders the text content of a social post card
 * @param post - The social post data
 * @returns Text content with hashtags and call-to-action
 */
const PostCardText = ({ post }: { post: SocialPostData }) => {
  return (
    <div className={clsx('px-2 mx-1 mb-1', post.platform === SocialPlatform.INSTAGRAM ? 'order-3' : 'order-2')}>
      <div className="text-sm">
        {post.content}{' '}
        {post.callToAction && (
          <span className="font-medium">
            {post.callToAction}{' '}
          </span>
        )}
        {post.hashtags && post.hashtags.length > 0 && (
          <span style={{ color: '#145FA9' }}>
            {formatHashtags(post.hashtags)}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Props for PostImage component
 */
interface PostImageProps {
  postImage: { url: string; prompt?: string } | null;
  imageAspectRatio: string;
  imagesRequested: boolean;
  platform: string;
}

/**
 * Renders the image for a social post card
 * @param postImage - Image data with URL and optional prompt
 * @param imageAspectRatio - CSS aspect-ratio value for the image container
 * @param imagesRequested - Whether images were requested for this post
 * @returns Image element or placeholder
 */
const PostImage = memo(({ postImage, imageAspectRatio, imagesRequested, platform }: PostImageProps) => {
  const t = useTranslations();
  const imageUrl = useAppImageUrl(postImage?.url);

  if (!imagesRequested) {
    return null;
  }

  return (
    <div className={clsx("mx-0.5 flex items-center justify-center relative mt-0.5", platform === SocialPlatform.INSTAGRAM ? 'order-2 mb-1' : 'order-3')}>
      {postImage && imageUrl ? (
        <img
          src={imageUrl}
          alt={postImage.prompt || "Post image"}
          className="w-full"
          style={{
            height: '300px',
            objectFit: 'cover'
          }}
        />
      ) : (
        <div className="w-full border-2 border-dashed border-intents-ux-border-borderColor bg-intents-ux-boxLowContrast-backgroundColor flex flex-col items-center justify-center gap-1" style={{ height: '300px' }}>
          <AlertIcon className="w-6 h-6 text-intents-ux-critical-textColor" />
          <span className="text-xs text-intents-ux-textSubtle-textColor">{t('builder_widgets_postcard_error')}</span>
        </div>
      )}
    </div>
  )
})

const PreviewHeader = memo(({ platform, previewDate }: { platform: string, previewDate: string }) => {
  return (
    <div className="flex items-center justify-between px-2 py-1 order-1">
      <div className="flex items-center">
        <div className="w-6 h-6 rounded-full border overflow-visible flex items-center justify-center">
          {PlatformIcon[platform]}
        </div>
        <div className="ml-1">
          <div className="flex items-center">
            <text.span className="mr-0.5" size={-1} emphasis='passive' as="paragraph"> {previewDate}</text.span>
            <svg width='28' height='18' viewBox='0 0 33 21' fill='none' xmlns='http://www.w3.org/2000/svg'>
              <rect y='0.825451' width='32.5291' height='19.5978' fill='url(#pattern0_20_4540)' />
              <defs>
                <pattern id='pattern0_20_4540' patternContentUnits='objectBoundingBox' width='1' height='1'>
                  <use xlinkHref='#image0_20_4540' transform='matrix(0.0172414 0 0 0.0286179 0 -0.0437401)' />
                </pattern>
                <image
                  id='image0_20_4540'
                  width='58'
                  height='38'
                  preserveAspectRatio='none'
                  xlinkHref='data:image/png;base64,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'
                />
              </defs>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
});

const PreviewFooter = memo(() => {
  const t = useTranslations();
  return (
    <div className="flex justify-between items-center mt-1 px-2 mx-1 order-4">
      <text.span as="paragraph" className="flex items-center gap-1" size={-1} emphasis='passive'>
        <LikeIcon className="w-3 h-3 text-intents-ux-textSubtle-textColor" />
        {t('builder_social_like')}
      </text.span>
      <text.span as="paragraph" className="flex items-center gap-1" size={-1} emphasis='passive'>
        <CommentIcon className="w-3 h-3 text-intents-ux-textSubtle-textColor" />
        {t('builder_social_comment')}
      </text.span>
      <text.span as="paragraph" className="flex items-center gap-1" size={-1} emphasis='passive'>
        <ShareIcon className="w-3 h-3 text-intents-ux-textSubtle-textColor" />
        {t('builder_social_share')}
      </text.span>
    </div>
  );
});

/**
 * Renders a preview card for a social post with platform-specific styling
 * @param post - The social post data to preview
 * @returns Social media post preview card
 */
export const PostCardPreview = ({ post }: { post: SocialPostData }) => {
  const imageAspectRatio = useMemo(() => {
    if (post.platform === SocialPlatform.INSTAGRAM) return '1 / 1';
    return '16 / 9';
  }, [post.platform]);

  const previewDate = useMemo(() => {
    const currentDate = new Date();
    return `${currentDate.toLocaleString('default', { month: 'long' })} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
  }, []);

  const postImage = useMemo(() => {
    return post.images && post.images.length > 0 ? post.images[0] : null;
  }, [post.images]);

  const imagesRequested = useMemo(() => {
    return !!(post as any).imagePrompt || (post.images && post.images.length > 0);
  }, [post]);

  return (
    <div className='shadow-xs flex flex-col border-intents-ux-border-borderColor mx-auto relative pb-1 h-auto border w-full'>
      <PreviewHeader platform={post.platform} previewDate={previewDate} />
      <PostCardText post={post} />
      <PostImage
        postImage={postImage}
        imageAspectRatio={imageAspectRatio}
        imagesRequested={imagesRequested}
        platform={post.platform}
      />
      <PreviewFooter />
    </div>
  )
}
