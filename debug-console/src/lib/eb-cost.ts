/**
 * Pure cost-attribution helpers, shared by the EB Langfuse sessions API
 * (`/api/eb-langfuse/sessions/[appId]`) and the conversation UI. Keeping the
 * normalization here means the API can return a ready-to-render `cost` summary
 * per trace, so non-UI consumers get the same shape instead of re-deriving it
 * from raw observations.
 *
 * No React / no server-only imports — safe to use from both route and component.
 */

// Shape of `output.attribution` on the `airo-app-builder/cost-attribution-result`
// EVENT observation. customerCost == BMS budgetCost (charged to customer);
// godaddyCost == BMS productCost (covered by GoDaddy).
export interface EbCostAttribution {
    customerCost: number;
    godaddyCost: number;
    costsByLabel?: Record<string, number>;
    labels?: string[];
    perCall?: Array<{ cost: number; payer: string; reason: string; label: string }>;
}

// Resolved from BMS (USD per credit). credits = customerCost / ratio.
export interface CreditRatioInfo {
    ratio: number | null;
    mixedRatios: boolean;
}

// Normalized, render-ready cost summary for one trace/turn.
export interface CostSummary {
    /** Authoritative total USD (trace.totalCost, falling back to customer+godaddy). */
    total: number | null;
    customer: number;
    godaddy: number;
    /** True when a cost-attribution payload was present (so the cust/gd split is meaningful). */
    hasSplit: boolean;
    /** customer USD converted to credits, or null when no ratio is available. */
    credits: number | null;
    mixedRatios: boolean;
    /** [shortLabel, usd] sorted by cost desc. */
    categories: Array<[string, number]>;
    totalCalls: number;
    customerCalls: number;
    godaddyCalls: number;
    /** Distinct short labels present in this trace (for the help panel). */
    labelsPresent: string[];
}

interface ObsLike {
    type?: string;
    name?: string;
    output?: unknown;
}
interface TraceLike {
    totalCost?: number | null;
    observations?: ObsLike[];
}

const COST_EVENT_NAME = 'airo-app-builder/cost-attribution-result';

export function shortLabel(label: string): string {
    return label.replace(/^airo-builder:/, '');
}

/** Pull the cost-attribution payload off the EVENT observation that buildSteps drops. */
export function extractCostAttribution(obs: ObsLike[] | undefined): EbCostAttribution | null {
    const event = (obs ?? []).find((o) => o.type === 'EVENT' && o.name === COST_EVENT_NAME);
    const output = event?.output;
    if (!output || typeof output !== 'object') return null;
    const attribution = (output as { attribution?: unknown }).attribution;
    if (!attribution || typeof attribution !== 'object') return null;
    const a = attribution as Record<string, unknown>;
    if (typeof a.customerCost !== 'number' || typeof a.godaddyCost !== 'number') return null;
    const costsByLabel =
        a.costsByLabel && typeof a.costsByLabel === 'object'
            ? (a.costsByLabel as Record<string, number>)
            : undefined;
    const labels = Array.isArray(a.labels) ? (a.labels as string[]) : undefined;
    const perCall = Array.isArray(a.perCall)
        ? (a.perCall as Array<{ cost: number; payer: string; reason: string; label: string }>)
        : undefined;
    return { customerCost: a.customerCost, godaddyCost: a.godaddyCost, costsByLabel, labels, perCall };
}

/** Build the render-ready CostSummary from a trace + its attribution + the BMS ratio. */
export function summarizeCost(
    trace: TraceLike,
    attribution: EbCostAttribution | null,
    creditRatio: CreditRatioInfo | null,
): CostSummary {
    const customer = attribution?.customerCost ?? 0;
    const godaddy = attribution?.godaddyCost ?? 0;
    const total = trace.totalCost ?? (attribution ? customer + godaddy : null);
    const credits = attribution && creditRatio?.ratio ? customer / creditRatio.ratio : null;
    const categories = attribution?.costsByLabel
        ? Object.entries(attribution.costsByLabel).sort((a, b) => b[1] - a[1])
        : [];
    const perCall = attribution?.perCall ?? [];
    const customerCalls = perCall.filter((c) => c.payer === 'customer').length;
    const godaddyCalls = perCall.filter((c) => c.payer === 'godaddy').length;

    const labelSet = new Set<string>();
    for (const [label] of categories) labelSet.add(shortLabel(label));
    for (const c of perCall) if (c.label) labelSet.add(shortLabel(c.label));
    for (const l of attribution?.labels ?? []) labelSet.add(shortLabel(l));

    return {
        total,
        customer,
        godaddy,
        hasSplit: attribution != null,
        credits,
        mixedRatios: !!creditRatio?.mixedRatios,
        categories,
        totalCalls: perCall.length,
        customerCalls,
        godaddyCalls,
        labelsPresent: [...labelSet],
    };
}

// One-line meanings for the cost labels (keyed by short label, prefix stripped).
// Sourced from packages/ai-lib/.../COST-ATTRIBUTION-GUIDELINES-AND-LABELS.md.
export const LABEL_GLOSSARY: Record<string, string> = {
    general: 'Productive AI work — charged to the customer.',
    'tool-failure': 'A tool errored; the wasted tokens are absorbed by GoDaddy.',
    'causal-chain': 'Agent caused a problem then fixed it; GoDaddy covers the self-inflicted cleanup.',
    'repeated-reads': 'Re-reading files it already read (3+) — confusion, not progress; GoDaddy covers.',
    'repeated-edits': 'Rewriting the same thing (5+) with no forward progress; GoDaddy covers.',
    'edit-read-loop': 'Stuck editing then re-reading (3+ cycles) with failures; GoDaddy covers.',
    'grep-spiral': 'Aimless searching (5+ grep/search calls); GoDaddy covers.',
    'terminal-failures': '3+ tool failures without recovery; GoDaddy covers.',
    'tool-retry': 'Retrying the same failing operation (3+); GoDaddy covers.',
    'no-output': 'Ran but produced no output; GoDaddy covers.',
    'publish-task': 'Publishing (a platform operation); GoDaddy covers.',
    'domain-task': 'Domain configuration (infrastructure); GoDaddy covers.',
    'infrastructure-overhead': 'System tools (suggestedResponse/todoList), not user-requested; GoDaddy covers.',
    'care-agent': 'Care agent acting on the customer’s behalf; GoDaddy covers all.',
    'test-accounts': 'Internal/test account; GoDaddy covers all.',
    'allowed-overage': 'Spend beyond the customer’s remaining credits; GoDaddy absorbs the remainder.',
};
