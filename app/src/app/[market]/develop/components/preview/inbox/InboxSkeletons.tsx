import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton';

const SKELETON_A11Y_ATTRS = {
  role: 'status' as const,
  'aria-busy': true,
  'aria-live': 'polite' as const,
};

function InboxConversationRowSkeleton({ index }: { index: number }) {
  const nameWidths: string[] = ['60%', '45%', '55%', '50%', '65%'];
  const previewWidths: string[] = ['80%', '70%', '75%', '85%', '60%'];
  return (
    <div className='flex items-center gap-2 border-b border-ux-border-subtle px-3 py-1.5'>
      <StaticSkeleton width='24px' height='24px' rounding='full' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          <StaticSkeleton width={nameWidths[index % nameWidths.length]} height='14px' />
          <div className='ml-auto shrink-0'>
            <StaticSkeleton width='40px' height='12px' />
          </div>
        </div>
        <div className='mt-1'>
          <StaticSkeleton width={previewWidths[index % previewWidths.length]} height='12px' />
        </div>
      </div>
    </div>
  );
}

export function InboxConversationListSkeleton() {
  return (
    <div
      data-testid='inbox-list-skeleton'
      {...SKELETON_A11Y_ATTRS}
    >
      {Array.from({ length: 5 }, (_: unknown, i: number) => (
        <InboxConversationRowSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

function MessageBubblesSkeleton() {
  return (
    <>
      <div className='flex w-full justify-start'>
        <StaticSkeleton width='60%' height='32px' className='rounded-lg' />
      </div>
      <div className='flex w-full justify-end'>
        <StaticSkeleton width='50%' height='32px' className='rounded-lg' />
      </div>
      <div className='flex w-full justify-start'>
        <StaticSkeleton width='70%' height='32px' className='rounded-lg' />
      </div>
      <div className='flex w-full justify-end'>
        <StaticSkeleton width='45%' height='32px' className='rounded-lg' />
      </div>
      <div className='flex w-full justify-start'>
        <StaticSkeleton width='55%' height='32px' className='rounded-lg' />
      </div>
    </>
  );
}

export function InboxConversationDetailSkeleton() {
  return (
    <div
      className='flex h-full min-h-0 flex-col'
      data-testid='inbox-detail-skeleton'
      {...SKELETON_A11Y_ATTRS}
    >
      <header className='flex min-h-0 shrink-0 items-center gap-1.5 border-b border-ux-border-subtle px-3 py-1.5'>
        <StaticSkeleton width='28px' height='28px' className='rounded-md' />
        <div className='ms-2 flex min-w-0 flex-1 flex-col gap-1'>
          <StaticSkeleton width='40%' height='14px' />
          <StaticSkeleton width='30%' height='12px' />
        </div>
        <StaticSkeleton width='72px' height='32px' className='rounded-md' />
      </header>

      <div className='flex flex-1 flex-col-reverse gap-1 px-3 py-3'>
        <MessageBubblesSkeleton />
      </div>

      <div className='mt-auto shrink-0 px-3 pb-3 pt-2'>
        <div className='rounded-lg border border-ux-border-subtle p-2'>
          <StaticSkeleton width='100%' height='36px' />
          <div className='mt-1 flex justify-end'>
            <StaticSkeleton width='28px' height='28px' rounding='full' />
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxMessageThreadSkeleton() {
  return (
    <div
      data-testid='inbox-thread-skeleton'
      className='flex flex-1 flex-col-reverse gap-1'
      {...SKELETON_A11Y_ATTRS}
    >
      <MessageBubblesSkeleton />
    </div>
  );
}

export function InboxMessagePaginationSkeleton() {
  return (
    <div
      data-testid='inbox-thread-pagination-skeleton'
      className='flex flex-col gap-1 py-2'
      {...SKELETON_A11Y_ATTRS}
    >
      <div className='flex w-full justify-start'>
        <StaticSkeleton width='40%' height='24px' className='rounded-lg' />
      </div>
      <div className='flex w-full justify-end'>
        <StaticSkeleton width='35%' height='24px' className='rounded-lg' />
      </div>
    </div>
  );
}
