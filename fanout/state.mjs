import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const REGION = process.env.AWS_REGION ?? 'us-west-2';
const client = new S3Client({ region: REGION });

/** Build the dedup state.json key for a (customerId, appId) tuple. */
export function keyFor(customerId, appId) {
  return `dedup/${encodeURIComponent(customerId)}/${encodeURIComponent(appId)}/state.json`;
}

/**
 * Read the dedup state for (customerId, appId). Returns:
 *   - null on 404 / NoSuchKey
 *   - { state, etag } on hit
 *
 * Throws on JSON parse failure (caller treats as fresh path).
 */
export async function readState({ bucket, customerId, appId }) {
  const Key = keyFor(customerId, appId);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key }));
    const text = await result.Body.transformToString();
    const state = JSON.parse(text);
    return { state, etag: result.ETag };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Write state.json with conditional semantics.
 *
 * - If `ifMatchEtag` provided → uses IfMatch (update).
 * - Else → uses IfNoneMatch: '*' (create-only).
 *
 * Throws on any S3 error including 412 PreconditionFailed (caller decides
 * whether to retry the read-modify-write or abort).
 */
export async function writeStateConditional({ bucket, customerId, appId, state, ifMatchEtag }) {
  const Key = keyFor(customerId, appId);
  const conditional = ifMatchEtag
    ? { IfMatch: ifMatchEtag }
    : { IfNoneMatch: '*' };
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key,
    Body: JSON.stringify(state),
    ContentType: 'application/json',
    ...conditional,
  }));
}
