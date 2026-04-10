import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { NodeEnvEnum } from '@godaddy/agent-observability-events';
import { createAgentSpanProcessor } from '@godaddy/agent-otel-sdk';

import { logger, toPinoLogger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

const nodeEnvMap = { dev: NodeEnvEnum.Development, test: NodeEnvEnum.Test, prod: NodeEnvEnum.Production } as const;

const observabilityEnabled = process.env.ENABLE_OBSERVABILITY_EVENTS === 'true';
const langfuseConfigured = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY;

if (observabilityEnabled || langfuseConfigured) {
  const spanProcessors: SpanProcessor[] = [];

  if (observabilityEnabled) {
    const apiKey = process.env.EVENTBUS_API_KEY;

    if (!apiKey) {
      logger.warn('instrumentation.init.missing_api_key', {
        message: 'EVENTBUS_API_KEY is not set; disabling observability span processor'
      });
    } else {
      spanProcessors.push(createAgentSpanProcessor({
        clientOptions: {
          nodeEnv: nodeEnvMap[resolveEnv()],

          eventBusOptions: { dxEnabled: false, apiKey },
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
