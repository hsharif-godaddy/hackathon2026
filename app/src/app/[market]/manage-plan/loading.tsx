import PageLayout from './components/PageLayout';
import ManagePlanSkeleton from './components/v2/ManagePlanSkeleton';

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
