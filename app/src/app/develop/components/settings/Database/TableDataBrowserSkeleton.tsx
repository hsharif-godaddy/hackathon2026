'use client'

import Box from '@ux/box';
import Button from '@ux/button';
import Skeleton from '@ux/skeleton';
import BigCard from '@/components/layout/BigCard';
import ArrowLeftIcon from '@ux/icon/arrow-left';
import PlusIcon from '@ux/icon/plus';
import { formatColumnName } from './utils';
import Table, {
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@ux/table';

interface TableDataBrowserSkeletonProps {
  tableName: string;
  onBack: () => void;
}

/**
 * Skeleton loading state for table data browser
 *
 * Displays a skeleton table with placeholder rows while data is loading.
 */
export function TableDataBrowserSkeleton({ tableName, onBack }: TableDataBrowserSkeletonProps) {
  const skeletonColumns = 6;
  const skeletonRows = 10;

  return (
    <Box orientation="vertical" gap="md" className="@container w-full">
      <div className="flex">
        <Button
          text="Back"
          icon={<ArrowLeftIcon />}
          onClick={onBack}
        />
      </div>
      <BigCard
        title={formatColumnName(tableName)}
        status={undefined}
        description={undefined}
        button={(
          <Button
            text="Add Row"
            icon={<PlusIcon />}
            design="primary"
            disabled
            onClick={() => {}}
          />
        )}
      >
        <div className="border rounded-lg overflow-x-auto">
          <Table stretch size="lg">
            <Thead>
              <Tr>
                {Array.from({ length: skeletonColumns }).map((_, index) => (
                  <Th key={`skeleton-header-${index}`} className="text-xs px-6 py-4 max-w-xs">
                    <Skeleton size="md" width="120px" />
                  </Th>
                ))}
                <Th className="text-xs px-4 py-3 w-24">
                  <Skeleton size="md" width="70px" />
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <Tr key={`skeleton-row-${rowIndex}`}>
                  {Array.from({ length: skeletonColumns }).map((_, colIndex) => (
                    <Td key={`skeleton-cell-${rowIndex}-${colIndex}`} className="font-mono text-xs px-4 py-2 max-w-xs">
                      <Skeleton
                        size="md"
                        width={colIndex % 3 === 0 ? '100px' : colIndex % 3 === 1 ? '140px' : '120px'}
                      />
                    </Td>
                  ))}
                  <Td key={`skeleton-cell-${rowIndex}-actions`} className="px-4 py-2 w-24">
                    <Skeleton size="md" width="60px" />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </BigCard>
    </Box>
  );
}

