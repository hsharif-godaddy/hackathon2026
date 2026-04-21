import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { getControlPlaneAdapter } from '@/lib/control-plane';
import { type CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';
import { logger } from '@/lib/request-context';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' });

const KEY_PATTERN = /^[a-zA-Z0-9_\-.]+$/;

export const dynamic = 'force-dynamic';

export const POST = withCustomerAuth(async (
  request: NextRequest,
  authContext: CustomerAuthContext,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> => {
  try {
    const { id: appId } = await params;

    const site = await getControlPlaneAdapter().getSite(appId, authContext.jwt);
    if (!site) {
      return NextResponse.json({ error: 'App not found' }, { status: 404 });
    }

    const bucketName = process.env.EVAL_SNAPSHOTS_BUCKET;
    if (!bucketName) {
      logger.error('publish-snapshots.upload.no-bucket', { message: 'EVAL_SNAPSHOTS_BUCKET not configured' });
      return NextResponse.json({ error: 'Publish snapshots not configured' }, { status: 503 });
    }

    const formData = await request.formData();
    const key = formData.get('key');
    const screenshot = formData.get('screenshot');
    const manifestJson = formData.get('manifest');

    if (
      typeof key !== 'string' ||
      !(screenshot instanceof File) ||
      typeof manifestJson !== 'string'
    ) {
      return NextResponse.json({ error: 'Missing or invalid fields: key, screenshot, manifest' }, { status: 400 });
    }

    if (!KEY_PATTERN.test(key)) {
      return NextResponse.json({ error: 'Invalid key format' }, { status: 400 });
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      return NextResponse.json({ error: 'Invalid manifest JSON' }, { status: 400 });
    }

    const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024; // 10 MB
    if (screenshot.size > MAX_SCREENSHOT_BYTES) {
      return NextResponse.json({ error: 'Screenshot too large (max 10 MB)' }, { status: 413 });
    }

    const screenshotBuffer = Buffer.from(await screenshot.arrayBuffer());
    const prefix = `snapshots/${appId}/publishes/${key}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `${prefix}/screenshot.png`,
      Body: screenshotBuffer,
      ContentType: 'image/png',
    }));

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: `${prefix}/manifest.json`,
      Body: JSON.stringify(manifest, null, 2),
      ContentType: 'application/json',
    }));

    logger.info('publish-snapshots.upload.success', { appId, key });

    return NextResponse.json({ success: true, appId, key });
  } catch (error) {
    logger.error('publish-snapshots.upload.failure', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
