import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server'

import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-west-2' })

const APP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/
const KEY_PATTERN = /^[a-zA-Z0-9_\-.]+$/
const MAX_SNAPSHOTS = 50

function getBucketName(): string {
  const bucketName = process.env.EVAL_SNAPSHOTS_BUCKET
  if (!bucketName) {
    throw new Error('EVAL_SNAPSHOTS_BUCKET environment variable is not set')
  }
  return bucketName
}

/**
 * Internal-only endpoint to list all publish snapshots for an app from S3.
 * Returns metadata for each snapshot (key, capturedAt, deploymentId, commitHash).
 *
 * GET /api/screenshots/publishes/[appId]
 *
 * Protected by VPN — no authentication required.
 *
 * IAM permissions required:
 * - s3:ListBucket on arn:aws:s3:::airo-eval-snapshots-dev (dev)
 * - s3:ListBucket on arn:aws:s3:::airo-eval-snapshots-prod (prod)
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-dev/* (dev)
 * - s3:GetObject on arn:aws:s3:::airo-eval-snapshots-prod/* (prod)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ appId: string }> }
) {
  const { appId } = await context.params

  if (!APP_ID_PATTERN.test(appId)) {
    return NextResponse.json({ error: 'Invalid appId format' }, { status: 400 })
  }

  const bucketName = getBucketName()
  const prefix = `snapshots/${appId}/publishes/`
  const requestUrl = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? requestUrl.host
  const proto = request.headers.get('x-forwarded-proto') ?? requestUrl.protocol.replace(':', '')
  const origin = `${proto}://${host}`

  try {
    // MaxKeys caps S3 listing at MAX_SNAPSHOTS; results beyond that are silently truncated
    // (intentional — no app is expected to have more than MAX_SNAPSHOTS publish snapshots).
    const listResult = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: '/',
      MaxKeys: MAX_SNAPSHOTS,
    }))

    const keys = (listResult.CommonPrefixes ?? [])
      .map(function extractKey(p) { return p.Prefix?.slice(prefix.length).replace('/', '') })
      .filter(function validKey(k): k is string { return !!k && KEY_PATTERN.test(k) })

    async function fetchManifest(key: string) {
      const screenshotUrl = `${origin}/api/screenshots/publishes/${appId}/${key}`
      try {
        const obj = await s3Client.send(new GetObjectCommand({
          Bucket: bucketName,
          Key: `${prefix}${key}/manifest.json`,
        }))
        const body = await obj.Body?.transformToString()
        const manifest = body ? JSON.parse(body) : {}
        return {
          key,
          screenshotUrl,
          capturedAt: manifest.capturedAt ?? null,
          deploymentId: manifest.deploymentId ?? null,
          commitHash: manifest.commitHash ?? null,
          deploymentStatus: manifest.deploymentStatus ?? null,
        }
      } catch (error) {
        logger.warn('screenshots.publishes.manifest.fetch-failed', {
          appId,
          key,
          error: error instanceof Error ? error.message : String(error),
        })
        return { key, screenshotUrl, capturedAt: null, deploymentId: null, commitHash: null, deploymentStatus: null }
      }
    }

    // Fetch manifests in batches of 10 to avoid S3 connection-pool pressure.
    const snapshots: Awaited<ReturnType<typeof fetchManifest>>[] = []
    for (let i = 0; i < keys.length; i += 10) {
      const batch = await Promise.all(keys.slice(i, i + 10).map(fetchManifest))
      snapshots.push(...batch)
    }

    snapshots.sort(function byDateDesc(a, b) {
      if (!a.capturedAt && !b.capturedAt) return 0
      if (!a.capturedAt) return 1
      if (!b.capturedAt) return -1
      return new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
    })

    logger.info('screenshots.publishes.list.success', { appId, count: snapshots.length })

    return NextResponse.json({ appId, snapshots })
  } catch (error) {
    logger.error('screenshots.publishes.list.error', {
      appId,
      bucket: bucketName,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Failed to list publish snapshots' }, { status: 500 })
  }
}
