export interface PublishEnvProjection {
  vars: Record<string, string>;
  updateIfCurrentValueIn?: Record<string, string[]>;
}

export interface PublishEnvContribution extends PublishEnvProjection {
  source: string;
}

export interface PublishEnvContributor {
  name: string;
  collect(appId: string): Promise<PublishEnvProjection>;
}

export function emptyPublishEnvProjection(): PublishEnvProjection {
  return { vars: {} };
}

function normalizeAllowedValues(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const deduped = [...new Set(values.filter((value) => value.length > 0))];
  return deduped.length > 0 ? deduped : undefined;
}

function assertCompatibleEnvValue(
  vars: Record<string, string>,
  key: string,
  value: string,
  source: string
): void {
  const existing = vars[key];
  if (existing !== undefined && existing !== value) {
    throw new Error(`Conflicting publish env value for ${key} from ${source}`);
  }
}

export function mergePublishEnvContributions(
  contributions: PublishEnvContribution[]
): PublishEnvProjection {
  const vars: Record<string, string> = {};
  const updateIfCurrentValueIn: Record<string, string[]> = {};

  for (const projection of contributions) {
    for (const [key, value] of Object.entries(projection.vars)) {
      assertCompatibleEnvValue(vars, key, value, projection.source);
      vars[key] = value;
    }

    for (const [key, values] of Object.entries(projection.updateIfCurrentValueIn ?? {})) {
      updateIfCurrentValueIn[key] = [
        ...(updateIfCurrentValueIn[key] ?? []),
        ...values,
      ];
    }
  }

  const normalizedUpdatePolicy = Object.fromEntries(
    Object.entries(updateIfCurrentValueIn)
      .map(([key, values]) => [key, normalizeAllowedValues(values)] as const)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))
  );

  return Object.keys(normalizedUpdatePolicy).length > 0
    ? { vars, updateIfCurrentValueIn: normalizedUpdatePolicy }
    : { vars };
}
