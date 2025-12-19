import { memo } from 'react'
import Box from '@ux/box'
import Skeleton from '@ux/skeleton'

import BigCard from '@/components/layout/BigCard'

export const SocialPanelLoadingSkeleton = memo(function SocialPanelLoadingSkeleton() {
  return (
    <BigCard
      title="Social Platforms"
      description="Manage your social media platform connections. Connect or disconnect platforms to control which accounts your app can interact with."
    >
      <Box orientation="vertical" gap="sm">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Box
            key={`skeleton-${i}`}
            orientation="horizontal"
            className="bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1.5"
            blockAlignChildren="spaceBetween"
            inlineAlignChildren="center"
          >
            <Box orientation="horizontal" gap="sm" inlineAlignChildren="center">
              <Skeleton rounding="full" size="sm" width="16px" height="16px" />
              <Skeleton size="sm" width="120px" height="20px" />
            </Box>
            <Skeleton size="sm" width="100px" height="20px" />
          </Box>
        ))}
      </Box>
    </BigCard>
  )
})
