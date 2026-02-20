import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { GDEnvEnum } from '@godaddy/agent-observability-events';
import { createAgentSpanProcessor } from '@godaddy/agent-otel-sdk';

import { logger, toPinoLogger } from '../logging/index.js';

function resolveGdEnv(): GDEnvEnum {
  switch (process.env.ENVIRONMENT_NAME) {
    case 'production': return GDEnvEnum.Prod;
    case 'test': return GDEnvEnum.Test;
    default: return GDEnvEnum.Dev;
  }
}

const observabilityEnabled = process.env.ENABLE_OBSERVABILITY_EVENTS === 'true';
const langfuseConfigured = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY;

if (observabilityEnabled || langfuseConfigured) {
  const spanProcessors: SpanProcessor[] = [];

  if (observabilityEnabled) {
    spanProcessors.push(createAgentSpanProcessor({
      clientOptions: {
        gdEnv: resolveGdEnv(),
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
