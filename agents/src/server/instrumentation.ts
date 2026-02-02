import { NodeSDK } from "@opentelemetry/sdk-node";

// Only initialize Langfuse when credentials are configured
// Langfuse SDK expects LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
const langfuseConfigured = process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY;

if (langfuseConfigured) {
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");

  const sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });

  sdk.start();
}