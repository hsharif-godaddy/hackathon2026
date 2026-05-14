import { createConfig as createLocalDev } from './environments/local.dev.js';
import { createConfig as createLocalTest } from './environments/local.test.js';
import { createConfig as createLocalProd } from './environments/local.prod.js';
import type { Config } from './environments/types.js';
import { EVAL_DEFAULTS } from './resolve-eval-config.js';
import type { ResolvedConfig } from './resolve-eval-config.js';

export type { Config, ResolvedConfig };

const ENV_CREATORS: Record<string, () => Config> = {
  'local.dev': createLocalDev,
  'local.test': createLocalTest,
  'local.prod': createLocalProd,
};

export function loadConfig(): ResolvedConfig {
  const env = process.env.GD_ENV ?? 'local.dev';
  const creator = ENV_CREATORS[env];
  if (!creator) {
    throw new Error(`Unknown GD_ENV: "${env}"`);
  }
  const config = creator();
  return {
    ...config,
    eval: {
      ...EVAL_DEFAULTS,
      ...config.eval,
    },
  };
}
