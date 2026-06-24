'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

interface EmptyStateCardProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  ctaLabel?: string;
  onCtaClick?: () => void;
  ctaDisabled?: boolean;
  ctaIcon?: React.ReactNode;
  secondaryCtaLabel?: string;
  onSecondaryCtaClick?: () => void;
}

/**
 * EmptyStateCard component for displaying locked/unavailable features
 *
 * Displays a clear message about why a feature is unavailable and provides
 * actionable next steps for the user to unlock it.
 *
 * @example
 * ```tsx
 * <EmptyStateCard
 *   icon={<DomainIcon width={48} height={48} />}
 *   title="Custom Domain"
 *   description="Connect your own domain or purchase a new one"
 *   ctaLabel="Publish to Unlock"
 *   onCtaClick={handlePublish}
 * />
 * ```
 */
export default function EmptyStateCard(props: EmptyStateCardProps) {
  const {
    icon,
    title,
    description,
    ctaLabel,
    onCtaClick,
    ctaDisabled = false,
    ctaIcon,
    secondaryCtaLabel,
    onSecondaryCtaClick,
  } = props;

  return (
    <Box
      gap="lg"
      blockAlignChildren="center"
      inlineAlignChildren="center"
      className="bg-intents-ux-box-backgroundColor rounded-lg p-3 @md:p-4 @lg:p-6"
    >
      {icon && (
        <Box blockAlignChildren="center" inlineAlignChildren="center">
          {icon}
        </Box>
      )}

      <Box gap="lg" blockAlignChildren="center" className="max-w-xl">
        <text.h3
          as="title"
          size={2}
          text={title}
          className="text-center"
        />

        <text.p
          as="paragraph"
          size={0}
          text={description}
          className="text-center text-pretty"
        />
      </Box>

      <Box
        orientation="horizontal"
        gap="md"
      >
        {ctaLabel && onCtaClick && (
          <Button
            size='sm'
            design="primary"
            text={ctaLabel}
            onClick={onCtaClick}
            disabled={ctaDisabled}
            icon={ctaIcon}
          />
        )}

        {secondaryCtaLabel && onSecondaryCtaClick && (
          <Button
            design="secondary"
            text={secondaryCtaLabel}
            onClick={onSecondaryCtaClick}
          />
        )}
      </Box>
    </Box>
  );
}

