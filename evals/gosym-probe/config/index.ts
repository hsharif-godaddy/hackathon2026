import { createConfig as createLocalDev } from './environments/local.dev.js';
import { createConfig as createLocalTest } from './environments/local.test.js';
import { createConfig as createLocalProd } from './environments/local.prod.js';
import type { Config } from './environments/types.js';

export type { Config };

const ENV_CREATORS: Record<string, () => Config> = {
  'local.dev': createLocalDev,
  'local.test': createLocalTest,
  'local.prod': createLocalProd,
};

export function loadConfig(): Config {
  const env = process.env.GD_ENV ?? 'local.dev';
  const creator = ENV_CREATORS[env];
  if (!creator) {
    throw new Error(`Unknown GD_ENV: "${env}"`);
  }
  return creator();
}
