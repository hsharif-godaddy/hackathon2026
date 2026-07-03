import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import type { WorkspaceClient } from '../client.js';
import type { WorkspaceVariant } from '../variant.js';
import type {
  WorkspaceSummary,
  WorkspaceCapabilities,
  WorkspaceMethodKey,
  WorkspaceNamespaceKey,
  MethodAvailability,
} from '../summary.js';
import type { WorkspaceFiles } from '../files.js';
import type { WorkspaceTasks } from '../tasks.js';
import type { WorkspaceRuntime } from '../runtime.js';
import type { WorkspaceDiagnostics } from '../diagnostics.js';
import type { WorkspaceArtifacts } from '../artifacts.js';
import type { WorkspaceImports } from '../imports.js';
import type { WorkspaceDeployments } from '../deployments.js';
import type { WorkspaceVersionControl } from '../version-control.js';
import type { WorkspaceConfig } from '../config.js';
import type { WorkspaceSetup } from '../setup.js';
import { WorkspaceNotImplementedError } from '../errors.js';
import { HttpFiles } from './http-files.js';
import { HttpTasks } from './http-tasks.js';
import { HttpRuntime } from './http-runtime.js';
import { HttpDiagnostics } from './http-diagnostics.js';
import { HttpArtifacts } from './http-artifacts.js';
import { HttpImports } from './http-imports.js';
import { HttpDeployments } from './http-deployments.js';
import { HttpVersionControl } from './http-version-control.js';
import { HttpConfig } from './http-config.js';
import { HttpSetup } from './http-setup.js';

const BASE_VERSIONS: Record<WorkspaceNamespaceKey, string> = {
  runtime: '1-partial',
  diagnostics: '1-logs-only',
  tasks: '2-full',
  files: '8-live',
  artifacts: '0-stubbed',
  imports: '0-stubbed',
  deployments: '0-partial',
  versionControl: '0-stubbed',
  config: '0-stubbed',
  setup: '1-live',
};

const COMMON_METHODS = {
  'runtime.status': 'live',
  'runtime.start': 'live',
  'runtime.stop': 'live',
  'runtime.restart': 'live',
  'runtime.check': 'live',
  'runtime.configureHealth': 'live',
  'diagnostics.logs': 'live',
  'diagnostics.errors': 'stubbed',
  'diagnostics.runtimeSummary': 'stubbed',
  'tasks.runCommand': 'live',
  'tasks.runCommandSync': 'live',
  'tasks.runCommandAsync': 'live',
  'tasks.get': 'live',
  'tasks.output': 'live',
  'tasks.cancel': 'live',
  'files.tree': 'live',
  'files.view': 'live',
  'files.search': 'live',
  'files.write': 'live',
  'files.edit': 'live',
  'files.delete': 'live',
  'files.move': 'live',
  'files.upload': 'live',
  'artifacts.createSourceBundle': 'stubbed',
  'artifacts.createBuildBundle': 'stubbed',
  'artifacts.upload': 'stubbed',
  'artifacts.get': 'stubbed',
  'artifacts.download': 'stubbed',
  'setup.getStatus': 'live',
  'setup.execute': 'live',
  summary: 'stubbed',
  capabilities: 'live',
} as const satisfies Partial<Record<WorkspaceMethodKey, MethodAvailability>>;

const PREVIEW_METHODS = {
  ...COMMON_METHODS,
  'deployments.prepare': 'stubbed',
  'deployments.activate': 'variant-not-applicable',
  'deployments.status': 'variant-not-applicable',
  'deployments.unpublish': 'variant-not-applicable',
  'imports.start': 'stubbed',
  'imports.get': 'stubbed',
  'imports.cancel': 'stubbed',
  'versionControl.status': 'stubbed',
  'versionControl.checkpoint': 'stubbed',
  'versionControl.history': 'stubbed',
  'versionControl.diff': 'stubbed',
  'versionControl.preparePublish': 'stubbed',
  'config.listEnv': 'stubbed',
  'config.upsertEnv': 'stubbed',
  'config.removeEnv': 'stubbed',
} as const satisfies Record<WorkspaceMethodKey, MethodAvailability>;

const PUBLISH_METHODS = {
  ...COMMON_METHODS,
  'deployments.prepare': 'variant-not-applicable',
  'deployments.activate': 'stubbed',
  'deployments.status': 'live',
  'deployments.unpublish': 'live',
  'imports.start': 'variant-not-applicable',
  'imports.get': 'variant-not-applicable',
  'imports.cancel': 'variant-not-applicable',
  'versionControl.status': 'variant-not-applicable',
  'versionControl.checkpoint': 'variant-not-applicable',
  'versionControl.history': 'variant-not-applicable',
  'versionControl.diff': 'variant-not-applicable',
  'versionControl.preparePublish': 'variant-not-applicable',
  'config.listEnv': 'stubbed',
  'config.upsertEnv': 'variant-not-applicable',
  'config.removeEnv': 'variant-not-applicable',
} as const satisfies Record<WorkspaceMethodKey, MethodAvailability>;

const PREVIEW_CAPABILITIES: WorkspaceCapabilities = Object.freeze({
  methods: Object.freeze({ ...PREVIEW_METHODS }),
  versions: Object.freeze({ ...BASE_VERSIONS }),
}) as WorkspaceCapabilities;

const PUBLISH_CAPABILITIES: WorkspaceCapabilities = Object.freeze({
  methods: Object.freeze({ ...PUBLISH_METHODS }),
  versions: Object.freeze({ ...BASE_VERSIONS }),
}) as WorkspaceCapabilities;

export class HttpWorkspaceClient implements WorkspaceClient {
  readonly files: WorkspaceFiles;
  readonly tasks: WorkspaceTasks;
  readonly runtime: WorkspaceRuntime;
  readonly diagnostics: WorkspaceDiagnostics;
  readonly artifacts: WorkspaceArtifacts;
  readonly imports: WorkspaceImports;
  readonly deployments: WorkspaceDeployments;
  readonly versionControl: WorkspaceVersionControl;
  readonly config: WorkspaceConfig;
  readonly setup: WorkspaceSetup;

  constructor(
    public readonly workspaceId: string,
    public readonly variant: WorkspaceVariant,
    client: DevSupervisorClient,
  ) {
    this.files = new HttpFiles(client);
    this.tasks = new HttpTasks(client);
    this.runtime = new HttpRuntime(client);
    this.diagnostics = new HttpDiagnostics(client);
    this.artifacts = new HttpArtifacts();
    this.imports = new HttpImports(variant);
    this.deployments = new HttpDeployments(client, variant);
    this.versionControl = new HttpVersionControl(variant);
    this.config = new HttpConfig(variant);
    this.setup = new HttpSetup(client);
  }

  async summary(): Promise<WorkspaceSummary> {
    throw new WorkspaceNotImplementedError('summary');
  }

  async capabilities(): Promise<WorkspaceCapabilities> {
    return this.variant === 'publish' ? PUBLISH_CAPABILITIES : PREVIEW_CAPABILITIES;
  }
}
