import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { INVESTIGATE_CONFIG } from './config';

const lambda = new LambdaClient({ region: INVESTIGATE_CONFIG.region });

export interface InvokeInvestigatorPayload {
  investigationId: string;
  appId: string;
  customerId: string;
  feedback: string;
  timeWindow: string | null;
  stateKey: string;
  historyPrefix: string;
  resultKey: string;
  tracePrefix: string;
  eventsPrefix: string;
  // Console is trigger-only: it resolves the agent URL and the Lambda mints
  // its own agent token from it (no JOMAX forwarding).
  agentUrl: string;
  source?: 'console' | 'feedback';
  category?: 'issue' | 'support' | 'feedback';
  rating?: number;
  topics?: string[];
  crmCaseId?: string;
  crmCaseNumber?: string;
}

export async function invokeInvestigator(payload: InvokeInvestigatorPayload): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: INVESTIGATE_CONFIG.lambdaFn,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
  }));
}
