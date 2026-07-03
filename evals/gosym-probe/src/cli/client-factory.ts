import { loadConfig } from '../../config/index.js';
import { PerTrialGocodeClient } from '../clients/per-trial-gocode-client.js';
import { AABCtrlPlaneClient } from '../clients/aab-ctrl-plane-client.js';
import { createAllScenarios } from '../scenarios/registry.js';
import { EvalStore } from '../store/eval-store.js';
import { BaselineStore } from '../baselines/baseline-store.js';
import { createFileStore } from '../storage/create-file-store.js';
import type { Config } from '../../config/environments/types.js';
import type { Scenario } from '../scenarios/types.js';

export interface CliDeps {
  config: Config;
  scenarios: Scenario[];
  evalStore: EvalStore;
  baselineStore: BaselineStore;
}

export function createCliDeps(): CliDeps {
  const config = loadConfig();
  const ctrlPlane = new AABCtrlPlaneClient({
    baseUrl: config.aab.controlPlaneUrl,
  });
  const gocodeClient = new PerTrialGocodeClient(config.gocode);
  const scenarios = createAllScenarios(gocodeClient, ctrlPlane, config);
  const evalStore = new EvalStore();
  const baselineStore = new BaselineStore('baselines', createFileStore(config));
  return { config, scenarios, evalStore, baselineStore };
}
