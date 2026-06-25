import { NodeSDK } from "@opentelemetry/sdk-node";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";
import { GDEnvEnum } from '@godaddy/agent-observability-events';
import { createAgentSpanProcessor } from '@godaddy/agent-otel-sdk';
import {
  AGENT_SERVICE_ID,
  AGENT_SERVICE_NAME,
  MULTI_AGENT_SYSTEM,
} from '@airo/ai-transport';

import { logger, toPinoLogger } from '../logging/index.js';
import { resolveEnv } from '../utils/gd-env.js';

const gdEnvMap = { dev: GDEnvEnum.Dev, test: GDEnvEnum.Test, prod: GDEnvEnum.Prod } as const;

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
          eventBusOptions: { dxEnabled: false, apiKey, env: gdEnvMap[resolveEnv()] },
          globalContext: {
            site: {
              privateLabelId: 1,
            },
            context: {
              userType: 'c1',
            },
            agent: {
              agentId: AGENT_SERVICE_ID,
              agentName: AGENT_SERVICE_NAME,
              multiAgentSystem: MULTI_AGENT_SYSTEM,
            },
          },
        },
        // Override default 10 min TTL to 30 min for slow AAB agent responses
        trackedSpanTtlMs: Number(process.env.TRACKED_SPAN_TTL_MS ?? 1_800_000),
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
