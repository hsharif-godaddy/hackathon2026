import { describe, expect, it } from 'vitest';

import { buildLakePartitionS3Key } from '@/lib/s3-parquet';

describe('s3-parquet', function s3ParquetTests() {
  describe('#buildLakePartitionS3Key', function buildLakePartitionS3KeyTests() {
    it('uses partition_utc_* hive keys for SEO quality lake writes', function partitionUtcKeys() {
      const now = new Date('2026-06-16T14:30:00.000Z');
      const fileId = 'abc123-snapshot-id';
      expect(buildLakePartitionS3Key('airo_builder_seo_quality_cln_laketest', now, fileId)).toBe(
        'airo_builder_seo_quality_cln_laketest/partition_utc_year=2026/partition_utc_month=06/partition_utc_day=16/partition_utc_hour=14/abc123-snapshot-id.parquet',
      );
    });
  });
});
