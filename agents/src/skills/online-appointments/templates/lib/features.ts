import featureConfig from "../appointment-features.json" with { type: "json" };

type FeatureConfig = typeof featureConfig.features;
type Namespace = keyof FeatureConfig;

// All keys of T except "enabled" — these are the addressable sub-features.
type ChildKeys<T> = string & Exclude<keyof T, "enabled">;

// Recursively generate all dot-notation paths through a feature subtree.
// For each child key K: always yields K, and yields "K.deeper" for every
// path reachable from T[K]. When a node has no children (ChildKeys → never),
// the recursion terminates. Handles any depth without code changes.
type SubPaths<T> = {
  [K in ChildKeys<T>]: K | `${K}.${SubPaths<T[K]>}`;
}[ChildKeys<T>];

/**
 * Literal union of all valid feature keys, derived from appointment-features.json.
 * Supports arbitrary nesting: "admin.bookings", "admin.settings.timezone",
 * "admin.bookings.events.one_time_event", etc.
 *
 * Adding a new entry to the JSON automatically widens this union.
 * Any invalid key ("admin.booking", "admin.settings.timezones") is a compile
 * error caught by `npm run type-check`, never a silent false at runtime.
 */
export type FeatureKey = {
  [N in Namespace]: N extends string ? `${N}.${SubPaths<FeatureConfig[N]>}` : never;
}[Namespace];

export function isFeatureEnabled(key: FeatureKey): boolean {
  const parts = key.split(".");
  // Walk the config tree one part at a time. parts[0] is namespace,
  // the rest are the path through the feature subtree.
  let node: unknown = featureConfig.features[parts[0] as Namespace];
  for (let i = 1; i < parts.length; i++) {
    node = (node as Record<string, unknown>)[parts[i] as string];
  }
  return (node as { enabled?: boolean }).enabled ?? false;
}

function collectFeatures(
  obj: Record<string, unknown>,
  prefix: string,
): Array<{ key: FeatureKey; enabled: boolean }> {
  return Object.entries(obj).flatMap(([k, val]) => {
    if (k === "enabled" || typeof val !== "object" || val === null) return [];
    const fullKey = `${prefix}.${k}`;
    return [
      { key: fullKey as FeatureKey, enabled: (val as { enabled: boolean }).enabled },
      ...collectFeatures(val as Record<string, unknown>, fullKey),
    ];
  });
}

export const ALL_FEATURES: Array<{ key: FeatureKey; enabled: boolean }> = Object.entries(
  featureConfig.features,
).flatMap(([ns, flags]) => collectFeatures(flags as Record<string, unknown>, ns));
