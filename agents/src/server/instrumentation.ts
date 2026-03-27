import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { GDEnvEnum, NodeEnvEnum } from '@godaddy/agent-observability-events';
import { createAgentSpanProcessor } from '@godaddy/agent-otel-sdk';

import { logger, toPinoLogger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

const gdEnvMap = { dev: GDEnvEnum.Dev, test: GDEnvEnum.Test, prod: GDEnvEnum.Prod } as const;

const nodeEnvMap = { dev: NodeEnvEnum.Development, test: NodeEnvEnum.Test, prod: NodeEnvEnum.Production } as const;

const observabilityEnabled = process.env.ENABLE_OBSERVABILITY_EVENTS === 'true';
const langfuseConfigured = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY;

if (observabilityEnabled || langfuseConfigured) {
  const spanProcessors: SpanProcessor[] = [];

  if (observabilityEnabled) {
    spanProcessors.push(createAgentSpanProcessor({
      clientOptions: {
        nodeEnv: nodeEnvMap[resolveEnv()],
        gdEnv: gdEnvMap[resolveEnv()],
        globalContext: {
          site: {
            privateLabelId: 1,
          },
          context: {
            userType: 'c1',
          },
        },
      },
      logger: toPinoLogger(logger),
    }));
  }

  if (langfuseConfigured) {
    const { LangfuseSpanProcessor } = await import("@langfuse/otel");
    spanProcessors.unshift(new LangfuseSpanProcessor());
  }

  const sdk = new NodeSDK({
    spanProcessors,
  });

  sdk.start();
}
