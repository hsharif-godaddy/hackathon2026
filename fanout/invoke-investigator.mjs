import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const client = new LambdaClient({ region: REGION });

/**
 * Async-invoke the investigator Lambda. Returns when AWS accepts the
 * invocation (StatusCode === 202). Does NOT wait for investigator to finish
 * — that would defeat the whole point of async fanout.
 */
export async function invokeInvestigator({ functionName, payload }) {
  const result = await client.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
  }));
  if (result.StatusCode !== 202) {
    throw new Error(`InvokeAsync returned ${result.StatusCode} (expected 202)`);
  }
}
