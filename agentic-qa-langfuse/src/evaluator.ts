import { type Config } from './config.js';
import { type LangfuseCredentials, type LangfuseTrace } from './langfuse-client.js';

export interface EvalContext {
  creds: LangfuseCredentials;
  config: Config;
  traces: LangfuseTrace[];
  workers: number;
}

export interface Evaluator {
  name: string;
  run(ctx: EvalContext): Promise<string>;
}
