import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { authenticateCustomer } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

const BUCKET_NAME = process.env.EVAL_SNAPSHOTS_BUCKET;
const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Require auth
    const authContext = await authenticateCustomer(request);
    if (!authContext.isAuthenticated) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!BUCKET_NAME) {
      logger.error('eval-snapshots.upload.no-bucket', { message: 'EVAL_SNAPSHOTS_BUCKET not configured' });
      return NextResponse.json({ error: 'Eval snapshots not configured' }, { status: 503 });
    }

    const formData = await request.formData();
    const appId = formData.get('appId');
    const screenshot = formData.get('screenshot');
    const manifestJson = formData.get('manifest');

    if (typeof appId !== 'string' || !(screenshot instanceof File) || typeof manifestJson !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid fields: appId (string), screenshot (file), manifest (string)' }, { status: 400 });
    }

    if (!APP_ID_PATTERN.test(appId)) {
      return NextResponse.json({ error: 'Invalid appId format' }, { status: 400 });
    }

    // Validate manifest JSON
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      return NextResponse.json({ error: 'Invalid manifest JSON' }, { status: 400 });
    }

    const s3 = s3Client;

    // Upload screenshot
    const screenshotBuffer = Buffer.from(await screenshot.arrayBuffer());
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `snapshots/${appId}/screenshot.png`,
      Body: screenshotBuffer,
      ContentType: 'image/png',
    }));

    // Upload manifest
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `snapshots/${appId}/manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));

    logger.info('eval-snapshots.upload.success', { appId });

    return NextResponse.json({ success: true, appId });
  } catch (error) {
    logger.error('eval-snapshots.upload.failure', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
