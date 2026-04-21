import ManagePlanSkeleton from './components/ManagePlanSkeleton';
import PageLayout from './components/PageLayout';

/**
 * Next.js loading UI shown immediately during navigation to /manage-plan.
 * This renders before the page bundle loads, providing instant feedback.
 */
export default function Loading() {
  return (
    <PageLayout>
      <ManagePlanSkeleton />
    </PageLayout>
  );
}
