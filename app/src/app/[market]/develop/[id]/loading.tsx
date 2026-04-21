import DevelopSkeleton from '@/app/[market]/develop/components/DevelopSkeleton'

/**
 * Next.js loading UI shown immediately during navigation to /develop/[id].
 * This renders before the page bundle loads, providing instant feedback.
 */
export default function Loading() {
  return <DevelopSkeleton />
}
