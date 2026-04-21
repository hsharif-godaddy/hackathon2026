'use client'

import Box from '@ux/box';
import Button from '@ux/button';
import ArrowLeftIcon from '@ux/icon/arrow-left';
import PlusIcon from '@ux/icon/plus';
import Skeleton from '@ux/skeleton';
import Table, {
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from '@ux/table';

import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import { useTranslations } from '@/hooks/useTranslations';
import { formatColumnName } from './utils';

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
  const t = useTranslations();
  const skeletonColumns = 6;
  const skeletonRows = 5;

  return (
    <Box orientation="vertical" gap="md" className="@container w-full">
      <div className="flex">
        <Button
          text="Back"
          icon={<ArrowLeftIcon />}
          onClick={onBack}
          design="inline"
          size="sm"
        />
      </div>
      <SettingsSection
        title={formatColumnName(tableName)}
        status={undefined}
        description={undefined}
        button={(
          <Button
            text={t('builder_settings_database_common_add_row')}
            icon={<PlusIcon />}
            design="primary"
            disabled
            onClick={() => {}}
            size="sm"
          />
        )}
      >
        <div className="border rounded-lg overflow-x-auto">
          <Table stretch size="md">
            <Thead>
              <Tr>
                {Array.from({ length: skeletonColumns }).map((_, index) => (
                  <Th key={`skeleton-header-${index}`} className="text-xs p-2 max-w-xs">
                    <Skeleton size="md" width="120px" />
                  </Th>
                ))}
                <Th className="text-xs p-2 w-12">
                  <Skeleton size="md" width="70px" />
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {Array.from({ length: skeletonRows }).map((_, rowIndex) => (
                <Tr key={`skeleton-row-${rowIndex}`}>
                  {Array.from({ length: skeletonColumns }).map((_, colIndex) => (
                    <Td key={`skeleton-cell-${rowIndex}-${colIndex}`} className="font-mono text-xs p-2 max-w-xs">
                      <Skeleton
                        size="md"
                        width={colIndex % 3 === 0 ? '100px' : colIndex % 3 === 1 ? '140px' : '120px'}
                      />
                    </Td>
                  ))}
                  <Td key={`skeleton-cell-${rowIndex}-actions`} className="p-2 w-12">
                    <Skeleton size="md" width="60px" />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </SettingsSection>
    </Box>
  );
}

