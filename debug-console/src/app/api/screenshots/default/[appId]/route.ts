import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' })

const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

function getBucketName(): string {
  const bucketName = process.env.EVAL_SNAPSHOTS_BUCKET
  if (!bucketName) {
    throw new Error('EVAL_SNAPSHOTS_BUCKET environment variable is not set')
  }
  return bucketName
}

/**
 * Internal-only endpoint to fetch eval snapshots from S3
 * Used by debug-console and internal systems
 * Protected by VPN - no authentication required
 *
 * IAM permissions required:
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-dev/* (dev)
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-prod/* (prod)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ appId: string }> }
) {
  const { appId } = await context.params

  // Validate appId format
  if (!APP_ID_PATTERN.test(appId)) {
    return NextResponse.json(
      { error: 'Invalid appId format' },
      { status: 400 }
    )
  }

  const BUCKET_NAME = getBucketName()

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `snapshots/${appId}/screenshot.png`,
    })

    const object = await s3Client.send(command)

    if (!object.Body) {
      return NextResponse.json(
        { error: 'Screenshot not found' },
        { status: 404 }
      )
    }

    // Stream S3 object directly to response to reduce memory pressure and improve time-to-first-byte
    const stream = object.Body.transformToWebStream()

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, no-cache, must-revalidate',
        'Content-Disposition': `inline; filename="${appId}-screenshot.png"`,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') {
      logger.info('screenshots.get.not-found', { appId })
      return NextResponse.json(
        { error: 'Screenshot not found' },
        { status: 404 }
      )
    }

    logger.error('screenshots.get.error', {
      appId,
      bucket: BUCKET_NAME,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      { error: 'Failed to retrieve screenshot' },
      { status: 500 }
    )
  }
}
