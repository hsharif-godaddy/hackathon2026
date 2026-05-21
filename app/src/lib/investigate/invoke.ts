import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { type FeedbackCategory } from '@/lib/feedback/category';
import { logger } from '@/lib/request-context';

export interface InvestigatorInvokePayload {
  investigationId: string;
  appId: string;
  customerId: string;
  feedback: string;
  fullstoryUrl: string | null;
  timeWindow: string | null;
  stateKey: string;
  historyPrefix: string;
  resultKey: string;
  tracePrefix: string;
  eventsPrefix: string;
  source: 'feedback';
  category: FeedbackCategory;
  rating?: number;
  topics: readonly string[];
  /**
   * Forwarded for `category === 'feedback'` only. Lets the Lambda
   * include consent context in the AI report's audit metadata
   * (matches the consent marker the BFF stamps on the CRM caseNote).
   */
  customerConsent?: boolean;
  crmCaseId?: string;
  crmCaseNumber?: string;
}

// Eager singleton: AWS SDK clients are stateless beyond region, and
// constructing once at module load avoids the module-level `let` /
// null-then-assign pattern flagged by the engineering guidelines.
const lambdaClient: LambdaClient = new LambdaClient({
  region: process.env.AWS_REGION ?? 'us-west-2',
});

export async function invokeInvestigator(payload: InvestigatorInvokePayload): Promise<void> {
  const fn = process.env.INVESTIGATE_LAMBDA_FN;
  if (!fn) {
    throw new Error('INVESTIGATE_LAMBDA_FN env var not set');
  }

  // Async (`InvocationType: 'Event'`) returns 202 on successful enqueue.
  // Non-2xx responses (e.g. 429 concurrency throttle) may resolve without
  // throwing on some SDK versions/middleware paths. Assert the status
  // explicitly so the BFF can surface invocation failures to the caller
  // and keep the dedup state consistent.
  const res = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: fn,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(payload), 'utf-8'),
    }),
  );

  if (res.StatusCode !== 202) {
    throw new Error(
      `Lambda async invoke returned StatusCode=${res.StatusCode ?? 'undefined'} (expected 202)`,
    );
  }

  logger.info('feedback.fanout.investigate.invoked', {
    investigationId: payload.investigationId,
    appId: payload.appId,
    customerId: payload.customerId,
    category: payload.category,
    hasCrmCaseId: !!payload.crmCaseId,
  });
}
