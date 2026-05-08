import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { INVESTIGATE_CONFIG } from './config';

const lambda = new LambdaClient({ region: INVESTIGATE_CONFIG.region });

export async function invokeInvestigator(payload: Record<string, unknown>): Promise<void> {
  await lambda.send(new InvokeCommand({
    FunctionName: INVESTIGATE_CONFIG.lambdaFn,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
  }));
}
