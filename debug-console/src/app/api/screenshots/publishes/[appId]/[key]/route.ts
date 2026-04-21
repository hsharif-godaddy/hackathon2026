import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' })

const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const KEY_PATTERN = /^[a-zA-Z0-9_\-.]+$/

function getBucketName(): string {
  const bucketName = process.env.EVAL_SNAPSHOTS_BUCKET
  if (!bucketName) {
    throw new Error('EVAL_SNAPSHOTS_BUCKET environment variable is not set')
  }
  return bucketName
}

/**
 * Internal-only endpoint to fetch a specific publish snapshot image from S3.
 * Streams the PNG directly from S3.
 *
 * GET /api/screenshots/publishes/[appId]/[key]
 *
 * Protected by VPN — no authentication required.
 *
 * IAM permissions required:
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-dev/* (dev)
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-prod/* (prod)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ appId: string; key: string }> }
) {
  const { appId, key } = await context.params

  if (!APP_ID_PATTERN.test(appId)) {
    return NextResponse.json({ error: 'Invalid appId format' }, { status: 400 })
  }

  if (!KEY_PATTERN.test(key)) {
    return NextResponse.json({ error: 'Invalid key format' }, { status: 400 })
  }

  const bucketName = getBucketName()

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: `snapshots/${appId}/publishes/${key}/screenshot.png`,
    })

    const object = await s3Client.send(command)

    if (!object.Body) {
      return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })
    }

    return new NextResponse(object.Body.transformToWebStream(), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-cache, must-revalidate',
        'Content-Disposition': `inline; filename="${appId}-${key}-screenshot.png"`,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      logger.info('screenshots.publishes.get.not-found', { appId, key })
      return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })
    }

    logger.error('screenshots.publishes.get.error', {
      appId,
      key,
      bucket: bucketName,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json({ error: 'Failed to retrieve screenshot' }, { status: 500 })
  }
}
