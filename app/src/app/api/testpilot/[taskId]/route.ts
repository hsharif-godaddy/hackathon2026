/**
 * TestPilot Task Polling API Route
 *
 * GET /api/testpilot/[taskId]
 *
 * Polls the TestPilot API for the results of a specific task ID.
 * Used for retrying timed out tests or checking task status.
 */

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';
import { testPilotClient } from '@/lib/testpilot';
import { testPilotTokenService } from '@/lib/testpilot/token-service';

/**
 * GET /api/testpilot/[taskId]
 *
 * Poll for the results of a specific TestPilot task
 *
 * @param request - Next.js request object
 * @param params - Route parameters containing taskId
 * @returns TestPilot task result or error
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;

  if (!taskId) {
    return NextResponse.json(
      { error: 'Task ID is required' },
      { status: 400 }
    );
  }

  logger.info('testpilot.poll-route.start', { taskId });

  try {
    const token = await testPilotTokenService.getToken();

    // Use the existing pollTaskResult method from the client
    // We use 'Security' as a default test type for logging purposes
    const pollResult = await testPilotClient.pollTaskResult(token, taskId);

    logger.info('testpilot.poll-route.response', {
      taskId,
      timedOut: pollResult.timedOut,
      hasResult: !!pollResult.result,
    });

    // Return the result in TestPilotRunResult format
    return NextResponse.json({
      results: pollResult.result,
      timedOut: pollResult.timedOut,
      taskId,
    });
  } catch (error) {
    logger.error('testpilot.poll-route.error', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        results: null,
        timedOut: false,
        taskId,
      },
      { status: 500 }
    );
  }
}
