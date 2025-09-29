/**
 * Nomad Job Template for Airo Agent Containers
 * Based on the architecture from control-plane-with-nomad branch
 */

export interface NomadJobConfig {
  accountId: string;
  siteId: string;
  jobName: string;
  cephMountId: string;
  cephDirNumber: string;
  agentImage?: string;
  appImage?: string;
}

export function generateNomadJobSpec(config: NomadJobConfig): { Job: { ID: string; [key: string]: unknown } } {
  const {
    accountId,
    siteId,
    jobName,
    cephMountId,
    cephDirNumber,
    agentImage = '418549769352.dkr.ecr.eu-central-1.amazonaws.com/airo-builder/agents:latest',
    appImage = '418549769352.dkr.ecr.eu-central-1.amazonaws.com/airo-builder/apps:latest'
  } = config;

  const agentsDomain = `agent-${siteId}.ab.sxb1.test-secureserver.net`;
  const frontendDomain = `preview-${siteId}.ab.sxb1.test-secureserver.net`;
  const agentsServiceName = `${siteId}-agents`;
  const frontendServiceName = `${siteId}-dev-frontend`;
  const customerAppDir = `\${NOMAD_ALLOC_DIR}/customer-app/${siteId}`;

  return {
    Job: {
      ID: jobName,
      Name: jobName,
      Type: "service",
      Priority: 50,
      Datacenters: ["*"],
      Namespace: 'sites',
      Constraints: [
        {
          LTarget: '${attr.plugins.cni.version.cilium-cni}',
          RTarget: '>= 2.0.6',
          Operand: 'semver'
        }
      ],
      TaskGroups: [{
        Name: 'airo-onegroup',
        Count: 1,
        Constraints: [
          {
            LTarget: '${node.class}',
            RTarget: 'onegroup',
            Operand: '='
          }
        ],
        Networks: [{
          Mode: 'cni/cilium',
          DynamicPorts: [
            {
              Label: 'http',
              To: 80,
              HostNetwork: 'default'
            },
            {
              Label: 'http20000',
              To: 20000,
              HostNetwork: 'default'
            }
          ]
        }],
        RestartPolicy: {
          Attempts: 3,
          Interval: 300000000000,  // 5 minutes in nanoseconds
          Delay: 30000000000,      // 30 seconds in nanoseconds
          Mode: 'fail'
        },
        Volumes: {},
        EphemeralDisk: {
          "Sticky": true,
          "SizeMB": 1024,
          "Migrate": false
        },
        Tasks: [
          {
            Name: 'pre-start',
            Driver: 'docker',
            User: 'root',
            lifecycle: {
              hook: 'prestart',
              sidecar: false
            },
            Config: {
              image: agentImage,
              auth_soft_fail: true,
              security_opt: [
                'label=type:airo_agent_container.process'
              ],
              entrypoint: ["/management-scripts/nomad_init.sh"],
              command: "echo '✅ Initialization complete'",
              mounts: [
                {
                  type: 'bind',
                  readonly: false,
                  source: `/mnt/ceph/${cephMountId}/${cephDirNumber}`,
                  target: '/ceph-storage'
                }
              ]
            },
            Env: {
              CUSTOMER_APP_DIR: customerAppDir,
              CEPH_STORAGE_DIR: `/ceph-storage/${accountId}/${siteId}`
            },
            Resources: {
              CPU: 10,
              MemoryMB: 10,
              MemoryMaxMB: 1024
            }
          },
          {
            Name: 'airo-agents',
            Driver: 'docker',
            User: 'agent',
            Config: {
              image: agentImage,
              auth_soft_fail: true,
              entrypoint: ["/management-scripts/nomad_setup_and_serve.sh"],
              command: "env AWS_PROFILE=${BEDROCK_AWS_PROFILE} node dist/server/app.js",
              ports: ['http'],
              security_opt: [
                'label=type:airo_agent_container.process'
              ],
              sysctl: [
                {
                  'net.ipv6.conf.all.disable_ipv6': '1'
                }
              ],
              healthchecks: {
                disable: false
              },
              volumes: [],
              mounts: [
                {
                  type: 'bind',
                  readonly: false,
                  source: `/mnt/ceph/${cephMountId}/${cephDirNumber}/${accountId}`,
                  target: '/ceph-storage'
                },
                {
                  type: 'bind',
                  readonly: false,
                  source: `/mnt/ceph/${cephMountId}/${cephDirNumber}/${accountId}/${siteId}/git-repo`,
                  target: `${customerAppDir}/.git`
                },
                {
                  type: 'bind',
                  readonly: true,
                  source: "/data/.aws/",
                  target: "/data/.aws/"
                }
              ]
            },
            Env: {
              SITE_ID: siteId,
              JOB_NAME: jobName,
              NOMAD_NAMESPACE: 'sites',
              LOG_LEVEL: 'info',
              NODE_ENV: 'development',
              PORT: '80',
              DB_PATH: `/ceph-storage/${siteId}/app/apps.db`,
              CUSTOMER_APP_DIR: customerAppDir,
              APPS_BASE_DIR: "${NOMAD_ALLOC_DIR}/customer-app",
              APP_TEMPLATE_DIR: '/app/app-templates/v8',
              GIT_REPO_DIR: `/ceph-storage/${siteId}/git-repo`,
              OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || 'https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net',
              OPENAI_MODEL: process.env.OPENAI_MODEL || 'claude-sonnet-4',
              ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS_FOR_AGENTS || '',
              AWS_SHARED_CREDENTIALS_FILE: "/data/.aws/credential_process",
              SSM_CREDENTIALS_FILE: "/data/.aws/credentials",
              BEDROCK_AWS_PROFILE: "bedrock",
              BEDROCK_AWS_ROLE_ARN: process.env.BEDROCK_AWS_ROLE_ARN || 'arn:aws:iam::694282668781:role/airobuilde-custom-dev-airo-builder-bedrock-access',
              BEDROCK_AWS_REGION: process.env.BEDROCK_AWS_REGION || 'us-west-2',
              GETTY_API_URL: process.env.GETTY_API_URL || 'https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net/img/search',
              GETTY_APP_KEY: process.env.GETTY_APP_KEY || 'airo-app-builder',
              GETTY_TOKEN: process.env.GETTY_TOKEN || '',
              ELASTIC_APM_SECRET_TOKEN: process.env.ELASTIC_APM_SECRET_TOKEN || '',
              ELASTIC_APM_SERVER_URL: process.env.ELASTIC_APM_SERVER_URL || '',
              SSO_HOST: process.env.SSO_HOST || 'sso.test-godaddy.com',
              BYPASS_AUTH_FOR_LOCAL: process.env.BYPASS_AUTH_FOR_LOCAL || 'true',
              PROXY_URL: process.env.PROXY_URL || 'https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net'
            },
            Resources: {
              CPU: 32,
              MemoryMB: 128,
              MemoryMaxMB: 512
            },
            Templates: [],
            LogConfig: {
              MaxFiles: 10,
              MaxFileSizeMB: 10,
              Disabled: false
            }
          },
          {
            Name: 'airo-dev-application',
            Driver: 'docker',
            User: 'agent',
            Config: {
              image: appImage,
              auth_soft_fail: true,
              ports: ['http20000'],
              security_opt: [
                'label=type:airo_app_container.process'
              ],
              sysctl: [
                {
                  'net.ipv6.conf.all.disable_ipv6': '1'
                }
              ],
              work_dir: '/app',
              healthchecks: {
                disable: false
              },
              volumes: [
                `..\${NOMAD_ALLOC_DIR}/customer-app/${siteId}:/app`
              ],
              mounts: [
                {
                  type: 'bind',
                  readonly: false,
                  source: `/mnt/ceph/${cephMountId}/${cephDirNumber}/${accountId}/${siteId}/git-repo`,
                  target: '/app/.git'
                }
              ]
            },
            Env: {
              SITE_ID: siteId,
              JOB_NAME: jobName,
              NODE_ENV: 'development',
              PORT: '20000',
              VITE_API_URL: `https://${frontendDomain}/api`,
              FRONTEND_DOMAIN: frontendDomain,
              RUNNING_IN_DOCKER: 'true',
              CUSTOMER_APP_DIR: '/app',
              DEV_SUPERVISOR_SOCKET_PATH: `\${NOMAD_ALLOC_DIR}/tmp/${siteId}-dev-supervisor.sock`,
              GIT_REPO_DIR: '/app/.git',
              BASE_APP_DIR: '/app-template',
              ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS_FOR_AGENTS || ''
            },
            Resources: {
              CPU: 32,
              MemoryMB: 256,
              MemoryMaxMB: 1024
            },
            LogConfig: {
              MaxFiles: 10,
              MaxFileSizeMB: 10,
              Disabled: false
            }
          }
        ],
        Services: [
          {
            Name: agentsServiceName,
            TaskName: 'airo-agents',
            PortLabel: 'http',
            AddressMode: 'alloc',
            Provider: 'nomad',
            Namespace: 'sites',
            Tags: [
              `${agentsServiceName}`,
              `traefik.enable=true`,
              `traefik.http.routers.${agentsServiceName}Http.entrypoints=tcp`,
              `traefik.http.routers.${agentsServiceName}Agents.tls=true`,
              `traefik.http.routers.${agentsServiceName}Agents.ruleSyntax=v3`,
              `traefik.http.routers.${agentsServiceName}Agents.rule=Host(\`${agentsDomain}\`)`,
              `traefik.http.services.${agentsServiceName}Http.loadbalancer.server.port=80`
            ],
            CanaryTags: [
              `${agentsServiceName}`,
              `traefik.enable=true`,
              `traefik.http.routers.${agentsServiceName}Agents.entrypoints=tcp`,
              `traefik.http.routers.${agentsServiceName}Agents.tls=true`,
              `traefik.http.routers.${agentsServiceName}Agents.ruleSyntax=v3`,
              `traefik.http.routers.${agentsServiceName}Agents.rule=Host(\`${agentsDomain}\`)`,
              `traefik.http.services.${agentsServiceName}Http.loadbalancer.server.port=80`
            ]
          },
          {
            Name: frontendServiceName,
            TaskName: 'airo-dev-application',
            PortLabel: 'http20000',
            AddressMode: 'alloc',
            Provider: 'nomad',
            Namespace: 'sites',
            Tags: [
              `${frontendServiceName}`,
              `traefik.enable=true`,
              `traefik.http.routers.${frontendServiceName}Http.entrypoints=tcp`,
              `traefik.http.routers.${frontendServiceName}Http.tls=true`,
              `traefik.http.services.${frontendServiceName}Http.loadbalancer.server.port=20000`,
              `traefik.http.routers.${frontendServiceName}Http.ruleSyntax=v3`,
              `traefik.http.routers.${frontendServiceName}Http.rule=Host(\`${frontendDomain}\`)`
            ],
            CanaryTags: [
              `${frontendServiceName}`,
              `traefik.http.routers.${frontendServiceName}Http.entrypoints=tcp`,
              `traefik.http.routers.${frontendServiceName}Http.tls=true`,
              `traefik.http.services.${frontendServiceName}Http.loadbalancer.server.port=20000`,
              `traefik.http.routers.${frontendServiceName}Http.ruleSyntax=v3`,
              `traefik.http.routers.${frontendServiceName}Http.rule=Host(\`${frontendDomain}\`)`
            ]
          }
        ]
      }]
    }
  };
}

/**
 * Generate job name from site ID (ensures unique job per site)
 */
export function generateJobName(siteId: string): string {
  return `site-${siteId}`;
}

/**
 * Extract allocation info from Nomad job status
 */
export function extractAllocationInfo(jobStatus: { Allocations?: Array<{
  ID: string;
  NodeName: string;
  ClientStatus: string;
  Resources?: {
    Networks?: Array<{
      DynamicPorts: Array<{ Label: string; Value: number }>
    }>
  };
}> }, siteId?: string): {
  allocId?: string;
  agentUrl?: string;
  backendUrl?: string;
  previewUrl?: string;
  status: 'pending' | 'running' | 'failed' | 'stopped';
} {
  if (!jobStatus || !jobStatus.Allocations) {
    return { status: 'pending' };
  }

  const allocations = jobStatus.Allocations;
  if (allocations.length === 0) {
    return { status: 'pending' };
  }

  // Get the most recent allocation
  const latestAlloc = allocations[0];
  const allocId = latestAlloc.ID;

  let status: 'pending' | 'running' | 'failed' | 'stopped' = 'pending';

  switch (latestAlloc.ClientStatus) {
    case 'running':
      status = 'running';
      break;
    case 'failed':
    case 'lost':
      status = 'failed';
      break;
    case 'complete':
      status = 'stopped';
      break;
    default:
      status = 'pending';
  }

  // Construct URLs using domain-based routing (Traefik setup)
  let agentUrl: string | undefined;
  let backendUrl: string | undefined;
  let previewUrl: string | undefined;

  if (status === 'running' && siteId) {
    // Use new domain format for agents, backend, and preview
    agentUrl = `https://agent-${siteId}.ab.sxb1.test-secureserver.net`;
    backendUrl = `https://backend-${siteId}.ab.sxb1.test-secureserver.net`;
    previewUrl = `https://preview-${siteId}.ab.sxb1.test-secureserver.net`;
  }

  return {
    allocId,
    agentUrl,
    backendUrl,
    previewUrl,
    status
  };
}
