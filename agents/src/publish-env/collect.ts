import {
  mergePublishEnvContributions,
  type PublishEnvContribution,
  type PublishEnvContributor,
  type PublishEnvProjection,
} from './types.js';

export async function collectPublishEnv(
  appId: string,
  contributors: PublishEnvContributor[] = []
): Promise<PublishEnvProjection> {
  const contributions: PublishEnvContribution[] = [];
  for (const contributor of contributors) {
    const projection = await contributor.collect(appId);
    contributions.push({
      source: contributor.name,
      ...projection,
    });
  }

  return mergePublishEnvContributions(contributions);
}
