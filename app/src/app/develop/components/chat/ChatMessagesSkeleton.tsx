import Box from '@ux/box';

import StaticSkeleton from '@/app/develop/components/StaticSkeleton';

export default function ChatMessagesSkeleton() {
  return (
    <Box orientation="vertical" gap="lg" className="pt-2">
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
        <div className="flex-1" />
        <Box orientation="vertical" gap="sm" className="max-w-[80%]">
          <StaticSkeleton width="180px" height="16px" />
          <StaticSkeleton width="240px" height="16px" />
        </Box>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
        <StaticSkeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
        <Box orientation="vertical" gap="sm" className="flex-1">
          <StaticSkeleton width="280px" height="16px" />
          <StaticSkeleton width="320px" height="16px" />
          <StaticSkeleton width="240px" height="16px" />
          <StaticSkeleton width="180px" height="16px" />
        </Box>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
        <div className="flex-1" />
        <Box orientation="vertical" gap="sm" className="max-w-[80%]">
          <StaticSkeleton width="200px" height="16px" />
        </Box>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
        <StaticSkeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
        <Box orientation="vertical" gap="sm" className="flex-1">
          <StaticSkeleton width="260px" height="16px" />
          <StaticSkeleton width="300px" height="16px" />
        </Box>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
        <div className="flex-1" />
        <Box orientation="vertical" gap="sm" className="max-w-[80%]">
          <StaticSkeleton width="160px" height="16px" />
          <StaticSkeleton width="220px" height="16px" />
        </Box>
      </Box>

      <Box orientation="horizontal" gap="sm" inlineAlignChildren="start">
        <StaticSkeleton rounding="full" width="24px" height="24px" className="flex-shrink-0 mt-0.5" />
        <Box orientation="vertical" gap="sm" className="flex-1">
          <StaticSkeleton width="290px" height="16px" />
          <StaticSkeleton width="310px" height="16px" />
          <StaticSkeleton width="270px" height="16px" />
        </Box>
      </Box>
    </Box>
  );
}
