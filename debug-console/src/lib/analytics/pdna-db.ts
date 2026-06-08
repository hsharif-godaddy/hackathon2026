import { pdnaClient, PDNA_PROVISIONING_INDEX } from './pdna-client';

/**
 * PDNA provisioning summary is a complete snapshot of all apps dumped every ~24h.
 * It can lag 3-4 days. We find the latest snapshot and use that single dump.
 */

const EXCLUDED_CUSTOMER_IDS = [
    '4ed63bdc-c61d-49d3-85b0-a406fc501632',
    '2ad30486-0384-4e6b-818e-2fae48e1f7a4',
];

// `tla_flag` separates customer-facing apps (false) from internal / test /
// marketing tenants (true). Default is `non-tla` everywhere — the TLA
// population has different usage patterns and skews the overall numbers.
export type PdnaTlaFilter = 'non-tla' | 'tla' | 'all';

// Optional subscription-plan filter. An empty array means "no plan filter"
// (all plans). A non-empty list restricts every PDNA metric to docs whose
// `airo_subscription_plan` is in the list.
export type PdnaPlanFilter = string[];

function buildBaseFilters(tla: PdnaTlaFilter = 'non-tla', planFilter: PdnaPlanFilter = []): Array<Record<string, unknown>> {
    const filters: Array<Record<string, unknown>> = [
        { bool: { must_not: [{ terms: { customer_id: EXCLUDED_CUSTOMER_IDS } }] } },
    ];
    if (tla === 'non-tla') filters.unshift({ term: { tla_flag: false } });
    else if (tla === 'tla') filters.unshift({ term: { tla_flag: true } });
    // 'all' → no tla_flag filter
    if (planFilter.length > 0) filters.push({ terms: { 'airo_subscription_plan.keyword': planFilter } });
    return filters;
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

export async function getPdnaSnapshot(tla: PdnaTlaFilter = 'non-tla', planFilter: PdnaPlanFilter = []) {
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
        ...buildBaseFilters(tla, planFilter),
    ];

    // One year of history for chart histograms. The UI filters the returned
    // daily series by the PDNA-section date preset (7d / 14d / 30d / 90d /
    // 6mo / 1yr / custom), so the backend returns the full envelope once.
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    let result;
    try {
        result = await pdnaClient.search({
            index: PDNA_PROVISIONING_INDEX,
            size: 0,
            body: {
                // Runtime field: hours between app creation and first publish.
                // Only emitted for apps where first_publish_utc_ts is set and
                // diff is non-negative (guards against clock skew / deletes).
                runtime_mappings: {
                    time_to_publish_hours: {
                        type: 'long',
                        script: {
                            source: "if (doc['first_publish_utc_ts'].size() > 0 && doc['app_create_utc_ts'].size() > 0) { long diff = doc['first_publish_utc_ts'].value.toInstant().toEpochMilli() - doc['app_create_utc_ts'].value.toInstant().toEpochMilli(); if (diff >= 0) { emit(diff / 3600000L); } }",
                        },
                    },
                },
                query: { bool: { filter } },
                aggs: {
                    total: { value_count: { field: 'app_id' } },
                    published: { filter: { term: { publish_flag: true } } },
                    ever_published: { filter: { exists: { field: 'first_publish_utc_ts' } } },
                    hibernated: { filter: { term: { hibernation_flag: true } } },
                    deleted: { filter: { exists: { field: 'app_delete_utc_ts' } } },
                    // Percentiles of time-to-first-publish (hours) over all
                    // apps that reached first publish.
                    time_to_publish_percentiles: {
                        percentiles: { field: 'time_to_publish_hours', percents: [50, 75, 90, 95, 99] },
                    },
                    // Apps distributed across Nomad cells (region+capacity view).
                    cells: { terms: { field: 'cell_id', size: 30 } },
                    // Pending/applied subscription downgrades. Each doc is an
                    // app; distinct subs via cardinality sub-agg.
                    downgrades: {
                        filter: { exists: { field: 'airo_subscription_downgrade_utc_ts' } },
                        aggs: { unique_subscriptions: { cardinality: { field: 'airo_subscription_id' } } },
                    },
                    ever_published_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'first_publish_utc_ts' } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    ever_published_by_day_by_plan: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'first_publish_utc_ts' } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    // Median time-to-publish per creation-date cohort.
                    time_to_publish_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'first_publish_utc_ts' } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: { p50: { percentiles: { field: 'time_to_publish_hours', percents: [50] } } },
                            },
                        },
                    },
                    // Apps with a real (customer-owned) domain attached —
                    // primary_domain_name is set AND doesn't end in
                    // `.airoapp.ai` (the default preview/publish subdomain).
                    // Strong signal of "customer reached the goal" — most
                    // such apps have publish_flag=true as well.
                    custom_domain: {
                        filter: {
                            bool: {
                                must: [{ exists: { field: 'primary_domain_name' } }],
                                must_not: [{ wildcard: { 'primary_domain_name.keyword': '*.airoapp.ai' } }],
                            },
                        },
                    },
                    // Cardinality of airo_subscription_id — PDNA has one doc
                    // per app; multiple apps may share a subscription.
                    total_subscriptions: { cardinality: { field: 'airo_subscription_id' } },
                    // Charts bucketed by app_create_utc_ts (no dedicated
                    // publish/hibernate timestamps exist — these show the
                    // published/hibernated cohort by creation date).
                    apps_created_by_day: {
                        filter: { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    // Same date histogram as above, further split by
                    // `airo_subscription_plan` so the UI can show a
                    // stacked bar (free / starter / professional /
                    // ultimate). Shares the same range + cohort.
                    apps_created_by_day_by_plan: {
                        filter: { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    apps_deleted_by_day: {
                        filter: { range: { app_delete_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_delete_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_deleted_by_day_by_plan: {
                        filter: { range: { app_delete_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_delete_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    apps_published_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { term: { publish_flag: true } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_hibernated_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { term: { hibernation_flag: true } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_hibernated_by_day_by_plan: {
                        filter: {
                            bool: {
                                must: [
                                    { term: { hibernation_flag: true } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    apps_custom_domain_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'primary_domain_name' } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                                must_not: [{ wildcard: { 'primary_domain_name.keyword': '*.airoapp.ai' } }],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_custom_domain_by_day_by_plan: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'primary_domain_name' } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                                must_not: [{ wildcard: { 'primary_domain_name.keyword': '*.airoapp.ai' } }],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    // Same custom-domain cohort as above, additionally
                    // restricted to apps that are currently published
                    // (publish_flag=true) — the strongest "live customer
                    // site" signal.
                    apps_custom_domain_published_by_day: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'primary_domain_name' } },
                                    { term: { publish_flag: true } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                                must_not: [{ wildcard: { 'primary_domain_name.keyword': '*.airoapp.ai' } }],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                            },
                        },
                    },
                    apps_custom_domain_published_by_day_by_plan: {
                        filter: {
                            bool: {
                                must: [
                                    { exists: { field: 'primary_domain_name' } },
                                    { term: { publish_flag: true } },
                                    { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                                ],
                                must_not: [{ wildcard: { 'primary_domain_name.keyword': '*.airoapp.ai' } }],
                            },
                        },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: { terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' } },
                                },
                            },
                        },
                    },
                    unique_customers_by_day: {
                        filter: { range: { app_create_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'app_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    unique_customers: { cardinality: { field: 'customer_id' } },
                                },
                            },
                        },
                    },
                    // Subscriptions created per day (by airo_subscription_create_utc_ts).
                    // Uses cardinality on airo_subscription_id because multiple apps
                    // can reference the same subscription.
                    subscriptions_created_by_day: {
                        filter: { range: { airo_subscription_create_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'airo_subscription_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    unique_subscriptions: { cardinality: { field: 'airo_subscription_id' } },
                                },
                            },
                        },
                    },
                    subscriptions_created_by_day_by_plan: {
                        filter: { range: { airo_subscription_create_utc_ts: { gte: oneYearAgo } } },
                        aggs: {
                            by_day: {
                                date_histogram: { field: 'airo_subscription_create_utc_ts', calendar_interval: '1d' },
                                aggs: {
                                    by_plan: {
                                        terms: { field: 'airo_subscription_plan.keyword', size: 10, missing: '__unknown__' },
                                        aggs: { unique_subscriptions: { cardinality: { field: 'airo_subscription_id' } } },
                                    },
                                },
                            },
                        },
                    },
                    // Status + plan breakdowns count DISTINCT subscriptions,
                    // not apps. PDNA has one doc per app; multiple apps can
                    // share a subscription, so `doc_count` would be
                    // app-count (inflated) — use a cardinality sub-agg on
                    // `airo_subscription_id` and expose that as the value.
                    statuses: {
                        terms: { field: 'airo_subscription_status', size: 10 },
                        aggs: { unique_subscriptions: { cardinality: { field: 'airo_subscription_id' } } },
                    },
                    plans: { terms: { field: 'token_budget_id', size: 10 } },
                    subscription_plans: {
                        terms: { field: 'airo_subscription_plan.keyword', size: 10 },
                        aggs: { unique_subscriptions: { cardinality: { field: 'airo_subscription_id' } } },
                    },
                },
            },
        });
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errMeta = err instanceof Error && 'meta' in err ? (err as { meta?: { body?: unknown } }).meta?.body : undefined;
        console.error('[pdna] Failed to fetch snapshot data', { snapshotDate, error: errMsg, body: errMeta ? JSON.stringify(errMeta).slice(0, 500) : undefined });
        return null;
    }

    const aggs = result.aggregations as Record<string, unknown>;
    if (!aggs) return null;
    const totalApps = ((aggs.total as { value: number })?.value) || 0;
    const publishedCount = ((aggs.published as { doc_count: number })?.doc_count) || 0;
    const hibernatedCount = ((aggs.hibernated as { doc_count: number })?.doc_count) || 0;
    const deletedCount = ((aggs.deleted as { doc_count: number })?.doc_count) || 0;

    type DayBucket = { key_as_string: string; doc_count: number; unique_customers?: { value: number } };
    function extractDailyBuckets(agg: unknown, getValue: (b: DayBucket) => number) {
        const buckets = ((agg as { by_day?: { buckets?: DayBucket[] } })?.by_day?.buckets ?? []);
        return buckets.map(b => ({ date: b.key_as_string.split('T')[0], value: getValue(b) }));
    }

    const totalSubscriptions = ((aggs.total_subscriptions as { value: number })?.value) || 0;
    const customDomainCount = ((aggs.custom_domain as { doc_count: number })?.doc_count) || 0;
    const everPublishedCount = ((aggs.ever_published as { doc_count: number })?.doc_count) || 0;
    const downgradesCount = ((aggs.downgrades as { unique_subscriptions?: { value: number } })?.unique_subscriptions?.value) || 0;

    const ttpPercentiles = ((aggs.time_to_publish_percentiles as { values?: Record<string, number> })?.values) ?? {};
    const timeToPublishHours = {
        p50: ttpPercentiles['50.0'] ?? null,
        p75: ttpPercentiles['75.0'] ?? null,
        p90: ttpPercentiles['90.0'] ?? null,
        p95: ttpPercentiles['95.0'] ?? null,
        p99: ttpPercentiles['99.0'] ?? null,
    };

    const cellBuckets = ((aggs.cells as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? []);
    const cells: Record<string, number> = {};
    for (const b of cellBuckets) cells[b.key] = b.doc_count;

    const appsCreatedDaily = extractDailyBuckets(aggs.apps_created_by_day, b => b.doc_count).map(d => ({ date: d.date, created: d.value }));

    // Daily breakdown buckets split by subscription plan. Either form is
    // supported: plain `doc_count` or a `unique_subscriptions` sub-agg
    // when we want distinct-subscription counts (e.g. subscriptions created).
    type PlanBucket = { key: string; doc_count: number; unique_subscriptions?: { value: number } };
    type PlanDayBucket = { key_as_string: string; by_plan?: { buckets?: PlanBucket[] } };
    function extractPlanDaily(aggPath: unknown, valueFrom: (b: PlanBucket) => number) {
        const days = ((aggPath as { by_day?: { buckets?: PlanDayBucket[] } })?.by_day?.buckets ?? []);
        return days.map(b => {
            const byPlan: Record<string, number> = {};
            for (const p of (b.by_plan?.buckets ?? [])) byPlan[p.key] = valueFrom(p);
            return { date: b.key_as_string.split('T')[0], byPlan };
        });
    }

    const appsCreatedDailyByPlan = extractPlanDaily(aggs.apps_created_by_day_by_plan, b => b.doc_count);
    const appsDeletedDailyByPlan = extractPlanDaily(aggs.apps_deleted_by_day_by_plan, b => b.doc_count);
    const everPublishedDailyByPlan = extractPlanDaily(aggs.ever_published_by_day_by_plan, b => b.doc_count);
    const appsHibernatedDailyByPlan = extractPlanDaily(aggs.apps_hibernated_by_day_by_plan, b => b.doc_count);
    const appsCustomDomainDailyByPlan = extractPlanDaily(aggs.apps_custom_domain_by_day_by_plan, b => b.doc_count);
    const appsCustomDomainPublishedDailyByPlan = extractPlanDaily(aggs.apps_custom_domain_published_by_day_by_plan, b => b.doc_count);
    const subscriptionsDailyByPlan = extractPlanDaily(aggs.subscriptions_created_by_day_by_plan, b => b.unique_subscriptions?.value ?? 0);
    const appsDeletedDaily = extractDailyBuckets(aggs.apps_deleted_by_day, b => b.doc_count).map(d => ({ date: d.date, deleted: d.value }));
    const appsPublishedDaily = extractDailyBuckets(aggs.apps_published_by_day, b => b.doc_count).map(d => ({ date: d.date, published: d.value }));
    const everPublishedDaily = extractDailyBuckets(aggs.ever_published_by_day, b => b.doc_count).map(d => ({ date: d.date, everPublished: d.value }));
    const appsHibernatedDaily = extractDailyBuckets(aggs.apps_hibernated_by_day, b => b.doc_count).map(d => ({ date: d.date, hibernated: d.value }));
    const appsCustomDomainDaily = extractDailyBuckets(aggs.apps_custom_domain_by_day, b => b.doc_count).map(d => ({ date: d.date, customDomain: d.value }));
    const appsCustomDomainPublishedDaily = extractDailyBuckets(aggs.apps_custom_domain_published_by_day, b => b.doc_count).map(d => ({ date: d.date, customDomain: d.value }));

    // Per-cohort median time-to-publish (hours). Each bucket has p50 nested.
    type TtpBucket = { key_as_string: string; p50?: { values?: Record<string, number | null> } };
    const ttpBuckets = ((aggs.time_to_publish_by_day as { by_day?: { buckets?: TtpBucket[] } })?.by_day?.buckets ?? []);
    const timeToPublishDaily = ttpBuckets.map(b => ({
        date: b.key_as_string.split('T')[0],
        medianHours: b.p50?.values?.['50.0'] ?? null,
    })).filter(d => d.medianHours !== null) as Array<{ date: string; medianHours: number }>;

    const uniqueCustomersDaily = extractDailyBuckets(aggs.unique_customers_by_day, b => b.unique_customers?.value ?? 0).map(d => ({ date: d.date, uniqueCustomers: d.value }));
    type SubsDayBucket = { key_as_string: string; unique_subscriptions?: { value: number } };
    const subscriptionsDailyBuckets = ((aggs.subscriptions_created_by_day as { by_day?: { buckets?: SubsDayBucket[] } })?.by_day?.buckets ?? []);
    const subscriptionsDaily = subscriptionsDailyBuckets.map(b => ({
        date: b.key_as_string.split('T')[0],
        subscriptions: b.unique_subscriptions?.value ?? 0,
    }));

    // Status + plan breakdowns use the cardinality sub-agg's value
    // (distinct subscription count), not `doc_count` (app count).
    type SubAggBucket = { key: string; doc_count: number; unique_subscriptions?: { value: number } };
    const statusBuckets = ((aggs.statuses as { buckets?: SubAggBucket[] })?.buckets ?? []);
    const statuses: Record<string, number> = {};
    for (const b of statusBuckets) statuses[b.key] = b.unique_subscriptions?.value ?? b.doc_count;

    const planBuckets = ((aggs.plans as { buckets?: Array<{ key: string; doc_count: number }> })?.buckets ?? []);
    const plans: Record<string, number> = {};
    for (const b of planBuckets) plans[b.key] = b.doc_count;

    const subscriptionPlanBuckets = ((aggs.subscription_plans as { buckets?: SubAggBucket[] })?.buckets ?? []);
    const subscriptionPlans: Record<string, number> = {};
    for (const b of subscriptionPlanBuckets) subscriptionPlans[b.key] = b.unique_subscriptions?.value ?? b.doc_count;

    return {
        snapshotDate: snapshotDate.split('T')[0],
        totalApps,
        publishedCount,
        publishRate: totalApps > 0 ? Math.round((publishedCount / totalApps) * 1000) / 10 : 0,
        hibernatedCount,
        hibernationRate: totalApps > 0 ? Math.round((hibernatedCount / totalApps) * 1000) / 10 : 0,
        deletedCount,
        totalSubscriptions,
        customDomainCount,
        customDomainRate: totalApps > 0 ? Math.round((customDomainCount / totalApps) * 1000) / 10 : 0,
        everPublishedCount,
        everPublishedRate: totalApps > 0 ? Math.round((everPublishedCount / totalApps) * 1000) / 10 : 0,
        downgradesCount,
        timeToPublishHours,
        cells,
        appsCreatedDaily,
        appsCreatedDailyByPlan,
        appsDeletedDaily,
        appsDeletedDailyByPlan,
        appsPublishedDaily,
        everPublishedDaily,
        everPublishedDailyByPlan,
        appsHibernatedDaily,
        appsHibernatedDailyByPlan,
        appsCustomDomainDaily,
        appsCustomDomainDailyByPlan,
        appsCustomDomainPublishedDaily,
        appsCustomDomainPublishedDailyByPlan,
        uniqueCustomersDaily,
        subscriptionsDaily,
        subscriptionsDailyByPlan,
        timeToPublishDaily,
        statuses,
        plans,
        subscriptionPlans,
    };
}

export type PdnaHourlyMetric = 'created' | 'deleted' | 'unique_customers';

const METRIC_FIELDS: Record<PdnaHourlyMetric, string> = {
    created: 'app_create_utc_ts',
    deleted: 'app_delete_utc_ts',
    unique_customers: 'app_create_utc_ts',
};

/**
 * Hourly breakdown for a single day, aggregated from the same snapshot
 * document as getPdnaSnapshot. `created`/`deleted` return a doc_count per
 * hour; `unique_customers` returns a cardinality of distinct customers
 * whose apps were created in that hour.
 */
export async function getPdnaHourlyStats(date: string, metric: PdnaHourlyMetric, tla: PdnaTlaFilter = 'non-tla', planFilter: PdnaPlanFilter = []): Promise<{ date: string; hourly_stats: Array<{ hour: number; value: number }> } | null> {
    if (!pdnaClient) return null;

    const snapshotDate = await getLatestSnapshotDate();
    if (!snapshotDate) return null;

    const field = METRIC_FIELDS[metric];
    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setUTCHours(23, 59, 59, 999);

    const filter: Record<string, unknown>[] = [
        { range: { summary_timestamp: { gte: `${snapshotDate}||/d`, lt: `${snapshotDate}||/d+1d` } } },
        { range: { [field]: { gte: startOfDay.toISOString(), lte: endOfDay.toISOString() } } },
        ...buildBaseFilters(tla, planFilter),
    ];

    const result = await pdnaClient.search({
        index: PDNA_PROVISIONING_INDEX,
        size: 0,
        body: {
            query: { bool: { filter } },
            aggs: {
                by_hour: {
                    date_histogram: { field, calendar_interval: '1h' },
                    ...(metric === 'unique_customers' && {
                        aggs: { unique_customers: { cardinality: { field: 'customer_id' } } },
                    }),
                },
            },
        },
    });

    const resultAggs = result.aggregations as Record<string, unknown>;
    const hourBuckets = ((resultAggs.by_hour as { buckets?: Array<{ key_as_string: string; doc_count: number; unique_customers?: { value: number } }> })?.buckets) ?? [];

    return {
        date,
        hourly_stats: hourBuckets.map(b => ({
            hour: new Date(b.key_as_string).getUTCHours(),
            value: metric === 'unique_customers' ? (b.unique_customers?.value ?? 0) : b.doc_count,
        })),
    };
}
