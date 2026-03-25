import { pdnaClient, PDNA_PROVISIONING_INDEX } from './pdna-client';

/**
 * PDNA provisioning summary is a complete snapshot of all apps dumped every ~24h.
 * It can lag 3-4 days. We find the latest snapshot and use that single dump.
 */

const EXCLUDED_CUSTOMER_IDS = [
    '4ed63bdc-c61d-49d3-85b0-a406fc501632',
    '2ad30486-0384-4e6b-818e-2fae48e1f7a4',
];

function buildBaseFilters() {
    return [
        { term: { tla_flag: false } },
        { bool: { must_not: [{ terms: { customer_id: EXCLUDED_CUSTOMER_IDS } }] } },
    ];
}

async function getLatestSnapshotDate(): Promise<string | null> {
    if (!pdnaClient) return null;

    const result = await pdnaClient.search({
        index: PDNA_PROVISIONING_INDEX,
        size: 0,
        body: {
            aggs: { latest: { max: { field: 'summary_timestamp' } } },
        },
    });

    return (result.aggregations?.latest as { value_as_string?: string })?.value_as_string ?? null;
}

export async function getPdnaSnapshot() {
    if (!pdnaClient) return null;

    let snapshotDate: string | null;
    try {
        snapshotDate = await getLatestSnapshotDate();
    } catch (err) {
        console.error('[pdna] Failed to fetch latest snapshot date', { error: err instanceof Error ? err.message : String(err) });
        return null;
    }
    if (!snapshotDate) return null;

    // Use ES date math to cover the full day of the latest snapshot
    const filter: Record<string, unknown>[] = [
        { range: { summary_timestamp: { gte: `${snapshotDate}||/d`, lt: `${snapshotDate}||/d+1d` } } },
        ...buildBaseFilters(),
    ];

    // 3 months ago for chart histograms
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let result;
    try {
        result = await pdnaClient.search({
            index: PDNA_PROVISIONING_INDEX,
            size: 0,
            body: {
                query: { bool: { filter } },
                aggs: {
                    total: { value_count: { field: 'app_id' } },
                    published: { filter: { term: { publish_flag: true } } },
                    hibernated: { filter: { term: { hibernation_flag: true } } },
                    deleted: { filter: { exists: { field: 'app_delete_utc_ts' } } },
                    // Charts limited to last 3 months
                    apps_created_by_day: {
                        filter: { range: { app_create_utc_ts: { gte: threeMonthsAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_deleted_by_day: {
                        filter: { range: { app_delete_utc_ts: { gte: threeMonthsAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_delete_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    unique_customers_by_day: {
                        filter: { range: { app_create_utc_ts: { gte: threeMonthsAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    unique_customers: { cardinality: { field: 'customer_id' } },
                                },
                            },
                        },
                    },
                    statuses: { terms: { field: 'airo_subscription_status', size: 10 } },
                    plans: { terms: { field: 'token_budget_id', size: 10 } },
                },
            },
        });
    } catch (err) {
        console.error('[pdna] Failed to fetch snapshot data', { snapshotDate, error: err instanceof Error ? err.message : String(err) });
        return null;
    }

    const aggs = result.aggregations as Record<string, unknown>;
    const totalApps = ((aggs.total as { value: number })?.value) || 0;
    const publishedCount = ((aggs.published as { doc_count: number })?.doc_count) || 0;
    const hibernatedCount = ((aggs.hibernated as { doc_count: number })?.doc_count) || 0;
    const deletedCount = ((aggs.deleted as { doc_count: number })?.doc_count) || 0;

    type DayBucket = { key_as_string: string; doc_count: number; unique_customers?: { value: number } };
    function extractDailyBuckets(agg: unknown, getValue: (b: DayBucket) => number) {
        const buckets = ((agg as { by_day?: { buckets?: DayBucket[] } })?.by_day?.buckets ?? []);
        return buckets.map(b => ({ date: b.key_as_string.split('T')[0], value: getValue(b) }));
    }

    const appsCreatedDaily = extractDailyBuckets(aggs.apps_created_by_day, b => b.doc_count).map(d => ({ date: d.date, created: d.value }));
    const appsDeletedDaily = extractDailyBuckets(aggs.apps_deleted_by_day, b => b.doc_count).map(d => ({ date: d.date, deleted: d.value }));
    const uniqueCustomersDaily = extractDailyBuckets(aggs.unique_customers_by_day, b => b.unique_customers?.value ?? 0).map(d => ({ date: d.date, uniqueCustomers: d.value }));

    const statusBuckets = ((aggs.statuses as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? []);
    const statuses: Record<string, number> = {};
    for (const b of statusBuckets) statuses[b.key] = b.doc_count;

    const planBuckets = ((aggs.plans as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? []);
    const plans: Record<string, number> = {};
    for (const b of planBuckets) plans[b.key] = b.doc_count;

    return {
        snapshotDate: snapshotDate.split('T')[0],
        totalApps,
        publishedCount,
        publishRate: totalApps > 0 ? Math.round((publishedCount / totalApps) * 1000) / 10 : 0,
        hibernatedCount,
        hibernationRate: totalApps > 0 ? Math.round((hibernatedCount / totalApps) * 1000) / 10 : 0,
        deletedCount,
        appsCreatedDaily,
        appsDeletedDaily,
        uniqueCustomersDaily,
        statuses,
        plans,
    };
}
