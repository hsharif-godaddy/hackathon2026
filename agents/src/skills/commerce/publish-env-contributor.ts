import type { PublishEnvContributor } from '../../publish-env/types.js';
import { getCommercePublishEnv } from './publish-env.js';

export const publishEnvContributor: PublishEnvContributor = {
  name: 'commerce',
  collect: getCommercePublishEnv,
};
