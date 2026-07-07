/**
 * s3.ts — read a transcript file object from S3 into a Buffer.
 */
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';

const client: S3Client = new S3Client({ region: REGION });

/**
 * Fetch an object and buffer its body. The transcript files are ≤50MB (upload
 * cap) so buffering in memory is fine within the Lambda's 1024MB.
 */
export async function getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`S3 object ${bucket}/${key} has no body`);
  }
  const bytes: Uint8Array = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
